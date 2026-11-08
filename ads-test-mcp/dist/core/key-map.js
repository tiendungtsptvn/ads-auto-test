import { ToolError } from './errors.js';
import { consoleBool } from './remote-config.js';
const KEY_NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const OVERRIDES_MAX = 500;
const CANDIDATES_SHOWN = 5;
/** Ngưỡng khớp tối thiểu khi tên không trùng hẳn (tỉ lệ từ chung). */
const GUESS_MIN = 0.6;
/** Đọc `key_overrides`: `{ "<dòng kịch bản>": ["key", ...] }`, giá trị chuỗi thì tách theo dấu phẩy. */
export function parseKeyOverrides(raw) {
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ToolError('key_overrides phải là object dạng {"<dòng kịch bản>": ["key", ...]}.');
    }
    const entries = Object.entries(raw);
    if (entries.length > OVERRIDES_MAX)
        throw new ToolError(`key_overrides có quá ${OVERRIDES_MAX} dòng.`);
    const out = new Map();
    for (const [rowText, v] of entries) {
        if (!/^\d{1,6}$/.test(rowText))
            throw new ToolError(`key_overrides: "${rowText.slice(0, 20)}" không phải số dòng.`);
        const list = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : undefined;
        if (!list || list.length === 0 || list.length > 10) {
            throw new ToolError(`key_overrides dòng ${rowText}: cần 1 đến 10 key.`);
        }
        const keys = list.map((k) => (typeof k === 'string' ? k.trim() : ''));
        if (keys.some((k) => !KEY_NAME_RE.test(k))) {
            throw new ToolError(`key_overrides dòng ${rowText}: tên key chỉ gồm chữ, số và các ký tự _ . -`);
        }
        out.set(Number(rowText), [...new Set(keys)]);
    }
    return out;
}
// ------------------------------------------------------------ suy key theo tên gần giống
const HF_TOKENS = new Set(['hf', '2id', '2f']);
const NOISE_TOKENS = new Set(['ad', 'ads']);
function nameParts(name) {
    const tokens = name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t && !NOISE_TOKENS.has(t));
    return { base: tokens.filter((t) => !HF_TOKENS.has(t)), hf: tokens.some((t) => HF_TOKENS.has(t)) };
}
function similarity(a, b) {
    if (a.join('') === b.join(''))
        return 1;
    const sa = new Set(a);
    const sb = new Set(b);
    if (sa.size === sb.size && [...sa].every((t) => sb.has(t)))
        return 1;
    const common = [...sa].filter((t) => sb.has(t)).length;
    return common / new Set([...sa, ...sb]).size;
}
/**
 * Suy key bật/tắt từ resource name (hoặc Ads name) bằng cách so tên với các key BOOLEAN trên console: bỏ từ
 * `ad`/`ads`, coi `hf`, `2ID`, `2f` là dấu HF; key phải cùng là HF hoặc cùng là ad thường với dòng kịch bản.
 * Ví dụ `fo_ad_banner_splash` → `fo_banner_splash`, `fo_ad_banner_splash_hf` → `fo_hf_banner_splash`.
 */
export function guessKey(name, isHF, consoleKeys) {
    const r = nameParts(name);
    // Resource HF có thể chỉ có hậu tố `_2` (ví dụ fo_nafu_af_02_2)
    if (isHF && !r.hf && r.base.length > 1 && r.base[r.base.length - 1] === '2')
        r.base.pop();
    if (r.base.length === 0)
        return { status: 'not_found' };
    let best = 0;
    let hits = [];
    for (const v of consoleKeys) {
        if (v.valueType !== 'BOOLEAN')
            continue;
        const k = nameParts(v.key);
        if (k.hf !== isHF || k.base.length === 0)
            continue;
        const s = similarity(r.base, k.base);
        if (s > best) {
            best = s;
            hits = [v.key];
        }
        else if (s === best && s > 0) {
            hits.push(v.key);
        }
    }
    if (best < GUESS_MIN || hits.length === 0)
        return { status: 'not_found' };
    if (hits.length > 1)
        return { status: 'ambiguous', candidates: hits.slice(0, CANDIDATES_SHOWN), score: best };
    return { status: 'found', key: hits[0], score: best };
}
// ------------------------------------------------------------ mapping
function lookupNames(row) {
    if (row.resources.length > 0)
        return row.resources;
    return row.adsName ? [row.adsName] : [];
}
export function mapRemoteKeys(script, cfg, acceptance, overrides) {
    const consoleKeys = [...cfg.values.values()];
    const onConsole = (key) => cfg.values.get(key.toLowerCase()) ?? null;
    return script.rows.map((row) => {
        const keys = [];
        const notes = [];
        let complete = true;
        const add = (key, source, from, detail) => {
            const cv = onConsole(key);
            const name = cv?.key ?? key;
            if (keys.some((k) => k.key.toLowerCase() === name.toLowerCase()))
                return;
            keys.push({ key: name, source, ...(from ? { from } : {}), ...(detail ? { detail } : {}), console: cv });
        };
        const override = overrides?.get(row.row);
        if (override) {
            for (const k of override)
                add(k, 'tester');
        }
        else if (row.enableKeySource === 'sheet') {
            for (const k of row.enableKeys)
                add(k, 'script');
        }
        else {
            const names = lookupNames(row);
            if (names.length === 0) {
                complete = false;
                notes.push('dòng không có resource name và Ads name để tìm key');
            }
            for (const name of names) {
                const lookup = acceptance?.findKey({ resource: name, adsName: row.adsName, isHF: row.isHF });
                if (lookup?.status === 'found') {
                    add(lookup.key, 'acceptance', name, `mục "${lookup.section}", ô ${lookup.ref}`);
                    continue;
                }
                const guess = guessKey(name, row.isHF, consoleKeys);
                if (guess.status === 'found') {
                    const exact = guess.score === 1;
                    add(guess.key, 'guess', name, exact ? 'trùng tên sau khi bỏ "ad" và dấu HF' : `gần giống, khớp ${Math.round(guess.score * 100)}% từ`);
                    notes.push(exact
                        ? `${name}: key ${guess.key} suy theo tên, tester xác nhận`
                        : `${name}: key ${guess.key} chỉ gần giống (khớp ${Math.round(guess.score * 100)}% từ), tester kiểm kỹ`);
                    continue;
                }
                complete = false;
                const accText = !acceptance ? 'chưa có file nghiệm thu' : lookup ? `file nghiệm thu: ${lookup.reason}` : '';
                notes.push(guess.status === 'ambiguous'
                    ? `${name}: nhiều key gần giống ngang nhau (${guess.candidates.join(', ')}), tester chọn${accText ? `; ${accText}` : ''}`
                    : `${name}: không tìm được key (${accText ? `${accText}; ` : ''}không có key gần giống trên console)`);
            }
        }
        for (const k of row.special?.enableKeys ?? [])
            add(k, 'special');
        for (const k of keys) {
            if (!k.console) {
                notes.push(`key ${k.key} không có trên console`);
            }
            else if (consoleBool(k.console) === undefined) {
                notes.push(k.console.value === null
                    ? `key ${k.key} dùng giá trị mặc định trong app, test thủ công (D-099)`
                    : `key ${k.key} kiểu ${k.console.valueType}, không phải true/false: test thủ công (D-099)`);
            }
        }
        return {
            row: row.row,
            phase: row.phase,
            adsName: row.adsName,
            resources: row.resources,
            isHF: row.isHF,
            special: !!row.special,
            keys,
            complete,
            notes,
        };
    });
}
/** Key có giá trị không phải true/false trên console (D-099). */
export function manualKeys(m) {
    return m.keys.filter((k) => k.console && consoleBool(k.console) === undefined).map((k) => k.key);
}
/** Bảng giá trị true/false của các key trên console, để `verify_ads` dùng thay khối Remote FO Prefs của log. */
export function consolePrefs(cfg) {
    const out = {};
    for (const v of cfg.values.values()) {
        const b = consoleBool(v);
        if (b !== undefined)
            out[v.key] = String(b);
    }
    return out;
}
//# sourceMappingURL=key-map.js.map