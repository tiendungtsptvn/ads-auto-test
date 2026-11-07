import { ToolError } from './errors.js';
import { analyzeAds } from './ad-events.js';
import { extractConfig } from './config.js';
import { entryText, matchesFilter, parseLogcat, TESTER_TAG_PREFIX, } from './logcat.js';
import { maskSecrets } from './mask.js';
import { readTextFile, validateInputFile } from './validate.js';
export const AD_LIMIT_DEFAULT = 15;
export const AD_LIMIT_MAX = 100;
export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 30;
export const ENTRY_TEXT_MAX = 300;
export const CONFIG_VALUES_MAX = 100;
export const MAX_WARNINGS = 5;
/** Đọc và phân tích file log. Không giữ trạng thái giữa các lần gọi (server stateless). */
export function loadLog(logPath) {
    const file = validateInputFile(logPath, 'log_path');
    const parsed = parseLogcat(readTextFile(file));
    if (parsed.entries.length === 0) {
        throw new ToolError('File log không có entry nào đọc được.');
    }
    return {
        parsed,
        ads: analyzeAds(parsed.entries),
        config: extractConfig(parsed.entries),
    };
}
function countBy(items, key) {
    const m = new Map();
    for (const it of items) {
        const k = key(it);
        m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
}
function pickLatest(config) {
    return config.snapshots[config.snapshots.length - 1];
}
function changedKeys(config) {
    if (config.snapshots.length < 2)
        return [];
    const first = config.snapshots[0].prefs;
    const last = pickLatest(config).prefs;
    const keys = new Set([...Object.keys(first), ...Object.keys(last)]);
    return [...keys].filter((k) => first[k] !== last[k]).sort().slice(0, 10);
}
function filterKeys(src, filter, budget) {
    const out = {};
    for (const [k, v] of Object.entries(src)) {
        if (filter && !k.toLowerCase().includes(filter.toLowerCase()))
            continue;
        if (budget.left <= 0)
            break;
        out[k] = v;
        budget.left--;
    }
    return out;
}
function countKeys(src, filter) {
    return Object.keys(src).filter((k) => !filter || k.toLowerCase().includes(filter.toLowerCase()))
        .length;
}
export function buildParseResult(log, opts = {}) {
    const { parsed, ads, config } = log;
    const entries = parsed.entries;
    const adOffset = opts.adOffset ?? 0;
    const adLimit = opts.adLimit ?? AD_LIMIT_DEFAULT;
    const pkgCounts = countBy(entries, (e) => e.pkg);
    const [mainPkg] = [...pkgCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const tagCounts = countBy(entries, (e) => e.tag);
    const rows = ads.ads.slice(adOffset, adOffset + adLimit).map((a) => ({
        id: a.id,
        type: a.adType,
        load: a.loadStart,
        ok: a.loadOk,
        fail: a.loadFail,
        show: a.show,
        ...(a.lastError ? { err: a.lastError } : {}),
        first: a.firstTime.slice(11),
        last: a.lastTime.slice(11),
    }));
    const nextOffset = adOffset + adLimit < ads.ads.length ? adOffset + adLimit : null;
    const latest = pickLatest(config);
    const remote = {
        snapshots: config.snapshots.length,
        prefs_keys: latest ? Object.keys(latest.prefs).length : 0,
        checklist_keys: latest ? Object.keys(latest.checklist).length : 0,
        changed_between_snapshots: changedKeys(config),
    };
    if (opts.includeConfig && latest) {
        const budget = { left: CONFIG_VALUES_MAX };
        const prefs = filterKeys(latest.prefs, opts.configFilter, budget);
        const checklist = filterKeys(latest.checklist, opts.configFilter, budget);
        const total = countKeys(latest.prefs, opts.configFilter) + countKeys(latest.checklist, opts.configFilter);
        remote.values = { prefs, checklist, truncated: total > CONFIG_VALUES_MAX };
    }
    return {
        package: mainPkg,
        lib_version: config.libVersion ?? null,
        lib_versions: config.libVersions,
        time_range: { first: entries[0].time, last: entries[entries.length - 1].time },
        entries: entries.length,
        total_lines: parsed.totalLines,
        unparsed_lines: parsed.unparsedLines,
        tag_counts: Object.fromEntries([...tagCounts.entries()].sort((a, b) => b[1] - a[1])),
        ads: { total: ads.ads.length, offset: adOffset, rows, next_offset: nextOffset },
        remote_config: remote,
        warnings: buildWarnings(log, pkgCounts, tagCounts),
    };
}
function buildWarnings(log, pkgCounts, tagCounts) {
    const w = [];
    const { parsed, ads, config } = log;
    const foreign = [...tagCounts.entries()].filter(([t]) => !t.startsWith(TESTER_TAG_PREFIX));
    if (foreign.length > 0) {
        const n = foreign.reduce((s, [, c]) => s + c, 0);
        w.push(`Log chưa lọc theo filter FOR_TESTER_: có ${n} entry thuộc ${foreign.length} tag khác.`);
    }
    if (parsed.unparsedLines > 0) {
        w.push(`Có ${parsed.unparsedLines} dòng không đọc được (không có ngày giờ và không thụt lề).`);
    }
    if (pkgCounts.size > 1) {
        w.push(`Log có ${pkgCounts.size} package khác nhau, kết quả lấy package xuất hiện nhiều nhất.`);
    }
    if (config.snapshots.length === 0) {
        w.push('Không thấy khối CONFIG (Remote FO Prefs / FO CONFIG CHECKLIST) trong log.');
    }
    else if (config.snapshots.length > 1) {
        w.push(`Log có ${config.snapshots.length} lần in CONFIG (app khởi động lại), giá trị lấy từ lần cuối.`);
    }
    if (ads.ads.length === 0) {
        w.push('Không thấy ad event nào (tag LOAD_AD, SHOW_AD, LOAD_FAILURE).');
    }
    if (ads.unknownTypeLabels.length > 0) {
        w.push(`Loại ad ngoài bảng ánh xạ: ${ads.unknownTypeLabels.join(', ')}.`);
    }
    if (ads.ads.some((a) => a.id === '')) {
        w.push('Có ad event với ad id trống (log in adUnitId rỗng), gom chung một dòng id rỗng.');
    }
    return w.slice(0, MAX_WARNINGS);
}
function cut(text, max) {
    return text.length > max ? `${text.slice(0, max)}...` : text;
}
function toMatch(e) {
    const flat = maskSecrets(entryText(e)).replace(/\s*\n\s*/g, ' ⏎ ');
    return {
        index: e.index,
        line: e.line,
        time: e.time,
        tag: e.tag,
        level: e.level,
        text: cut(flat, ENTRY_TEXT_MAX),
    };
}
export function searchEntries(entries, opts) {
    const limit = Math.min(Math.max(opts.limit ?? SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX);
    let start = 0;
    if (opts.cursor !== undefined) {
        if (!/^\d{1,9}$/.test(opts.cursor))
            throw new ToolError('cursor không hợp lệ.');
        start = Number(opts.cursor);
    }
    const filter = { tag: opts.tag, text: opts.text, adId: opts.adId };
    const hits = [];
    let total = 0;
    let nextCursor = null;
    for (const e of entries) {
        if (!matchesFilter(e, filter))
            continue;
        total++;
        if (e.index < start)
            continue;
        if (hits.length < limit)
            hits.push(e);
        else if (nextCursor === null)
            nextCursor = String(e.index);
    }
    return { matches: hits.map(toMatch), total_matched: total, next_cursor: nextCursor };
}
//# sourceMappingURL=summary.js.map