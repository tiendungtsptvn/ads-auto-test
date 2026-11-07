const AD_ID_RE = /^ca-app-pub-\d+\/\d+$/;
const TIMELINE_MAX = 15;
const EVIDENCE_MAX = 5;
const PAIR_LINES_MAX = 40;
// ------------------------------------------------------------ tiện ích về event và key
const fmt = (ev) => `${ev.time.slice(11)} ${ev.kind}${ev.error ? ` (${ev.error})` : ''} (dòng ${ev.line})`;
/**
 * Dòng load ok hoặc fail lẻ: không có dòng "starting load" nào đang chờ kết quả (D-086). Đếm số lần bắt đầu
 * đang chờ, vì log có thể in hai lần bắt đầu rồi hai kết quả.
 */
export function loneResults(events) {
    const out = [];
    let pending = 0;
    for (const ev of events) {
        if (ev.kind === 'load_start')
            pending++;
        else if (ev.kind === 'load_ok' || ev.kind === 'load_fail') {
            if (pending > 0)
                pending--;
            else
                out.push(ev);
        }
    }
    return out;
}
function parseBool(v) {
    if (v === undefined)
        return undefined;
    const t = v.trim().toLowerCase();
    return t === 'true' ? true : t === 'false' ? false : undefined;
}
/** Bật nếu có key = true; tắt nếu đã biết đủ key và mọi key đều = false. */
function keyState(rk, prefs) {
    if (!prefs || rk.keys.length === 0)
        return 'unknown';
    const vals = rk.keys.map((k) => parseBool(prefs[k]));
    if (vals.some((v) => v === true))
        return 'enabled';
    if (rk.complete && vals.every((v) => v === false))
        return 'disabled';
    return 'unknown';
}
/** Trạng thái của một ID gộp theo mọi dòng dùng ID đó (D-088): bật nếu có dòng bật, tắt nếu mọi dòng đều tắt. */
function combine(states) {
    if (states.length === 0)
        return 'unknown';
    if (states.some((s) => s === 'enabled'))
        return 'enabled';
    if (states.every((s) => s === 'disabled'))
        return 'disabled';
    return 'unknown';
}
/** Snapshot CONFIG đang có hiệu lực tại một thời điểm (lần in CONFIG gần nhất trước đó). */
function snapshotAt(snaps, time) {
    let pick = snaps[0];
    for (const s of snaps) {
        if (s.time <= time)
            pick = s;
        else
            break;
    }
    return pick;
}
/** Trạng thái qua mọi lần in CONFIG: chỉ kết luận khi mọi lần đều như nhau. */
function overallState(stateAt, snaps) {
    if (snaps.length === 0)
        return 'unknown';
    const states = snaps.map((s) => stateAt(s.prefs));
    if (states.every((s) => s === 'disabled'))
        return 'disabled';
    if (states.every((s) => s === 'enabled'))
        return 'enabled';
    return 'unknown';
}
function worst(statuses) {
    if (statuses.includes('FAIL'))
        return 'FAIL';
    if (statuses.includes('REVIEW'))
        return 'REVIEW';
    return 'OK';
}
function sampleEvidence(lines) {
    return lines.length > EVIDENCE_MAX ? [...lines.slice(0, EVIDENCE_MAX), `... còn ${lines.length - EVIDENCE_MAX} chỗ nữa`] : lines;
}
// ------------------------------------------------------------ các kiểm tra theo từng ID (D-063 d, e)
/** Rule (d): load fail thì không được show khi chưa có lần load thành công mới. */
export function failThenShow(events) {
    const out = [];
    let failed;
    for (const ev of events) {
        if (ev.kind === 'load_fail')
            failed = ev;
        else if (ev.kind === 'load_ok')
            failed = undefined;
        else if (ev.kind === 'show' && failed) {
            out.push(`fail lúc ${fmt(failed)} rồi show lúc ${fmt(ev)} mà chưa có load thành công mới`);
        }
    }
    return out;
}
/**
 * Rule (e): không có hai lần bắt đầu load liên tiếp mà không có show hoặc fail ở giữa. Ca đã load ok rồi load
 * lại mà chưa show vẫn là FAIL (D-087), kèm ghi chú vì có thể do preload hoặc reload.
 */
export function loadMoreThanOnce(events) {
    const out = [];
    let lastStart;
    let okBetween;
    for (const ev of events) {
        if (ev.kind === 'load_start') {
            if (lastStart) {
                out.push(okBetween
                    ? `2 lần bắt đầu load: ${fmt(lastStart)} rồi ${fmt(ev)}, ở giữa đã load ok lúc ${fmt(okBetween)} nhưng chưa show (có thể do preload hoặc reload, tester xem lại, D-087)`
                    : `2 lần bắt đầu load liên tiếp: ${fmt(lastStart)} rồi ${fmt(ev)}, chưa có show hoặc fail ở giữa`);
            }
            lastStart = ev;
            okBetween = undefined;
        }
        else if (ev.kind === 'load_ok') {
            if (lastStart)
                okBetween = ev;
        }
        else if (ev.kind === 'show' || ev.kind === 'load_fail') {
            lastStart = undefined;
            okBetween = undefined;
        }
    }
    return out;
}
export const HF_END_HINT = 'có thể báo nhầm nếu log dừng trước khi ad thường được load, D-087';
/**
 * Rule HF trước (D-063 a, b, c) cho một cặp mà cả hai key đều bật: trả về các vi phạm. Một lần request chỉ
 * tính từ dòng "starting load"; dòng ok hoặc fail lẻ bị bỏ qua (D-086).
 */
export function highFloorViolations(hf, normal) {
    const lone = new Set([...loneResults(hf), ...loneResults(normal)]);
    const merged = [
        ...hf.filter((ev) => !lone.has(ev)).map((ev) => ({ ev, side: 'hf' })),
        ...normal.filter((ev) => !lone.has(ev)).map((ev) => ({ ev, side: 'normal' })),
    ]
        .map((m) => ({ ...m, attempt: m.ev.kind === 'load_start' }))
        .sort((a, b) => a.ev.entryIndex - b.ev.entryIndex);
    const out = [];
    let hfAttempted = false;
    let hfLast = 'none';
    let hfLastEv;
    let pendingFail;
    for (const m of merged) {
        if (m.side === 'hf') {
            if (m.attempt) {
                hfAttempted = true;
                hfLast = 'start';
                hfLastEv = m.ev;
            }
            if (m.ev.kind === 'load_ok')
                hfLast = 'ok';
            if (m.ev.kind === 'load_fail') {
                hfLast = 'fail';
                pendingFail = m.ev;
            }
        }
        else if (m.attempt) {
            if (!hfAttempted) {
                out.push(`(a) ad thường load lúc ${fmt(m.ev)} khi HF chưa được load trước`);
            }
            else if (hfLast === 'ok') {
                out.push(`(b) HF đã load thành công (${fmt(hfLastEv)}) nhưng ad thường vẫn load lúc ${fmt(m.ev)}`);
            }
            else if (hfLast === 'start') {
                out.push(`(c) ad thường load lúc ${fmt(m.ev)} khi HF chưa có kết quả load`);
            }
            hfAttempted = false;
            hfLast = 'none';
            pendingFail = undefined;
        }
    }
    if (pendingFail)
        out.push(`(c) HF load fail lúc ${fmt(pendingFail)} nhưng không thấy ad thường được load sau đó (${HF_END_HINT})`);
    return out;
}
// ------------------------------------------------------------ đối chiếu chính
export function verifyAds(input) {
    const { script, log, acceptance } = input;
    const snaps = log.config.snapshots;
    const latest = snaps[snaps.length - 1];
    const byId = new Map();
    for (const ev of log.ads.events) {
        let list = byId.get(ev.id);
        if (!list)
            byId.set(ev.id, (list = []));
        list.push(ev);
    }
    const eventsOf = (id) => byId.get(id) ?? [];
    const summaryOf = (id) => log.ads.ads.find((a) => a.id === id);
    // ---- key bật/tắt của từng dòng; dòng có resource mà không ghi key thì tra file nghiệm thu (D-083)
    const keyLookups = [];
    const rowKeys = new Map();
    for (const row of script.rows) {
        const extra = row.special?.enableKeys ?? [];
        let rk;
        if (row.enableKeySource === 'sheet') {
            rk = { keys: [...new Set([...row.enableKeys, ...extra])], complete: true, missing: [] };
        }
        else if (row.enableKeySource === 'ads_name') {
            rk = { keys: [...extra], complete: false, missing: ['key ad in-app lấy từ Firebase theo condition Tester_<version>, cần console (M4)'] };
        }
        else if (row.special || row.resourceSource !== 'resource') {
            rk = { keys: [...extra], complete: extra.length > 0, missing: extra.length > 0 ? [] : ['kịch bản không ghi key bật/tắt'] };
        }
        else if (!acceptance) {
            rk = { keys: [], complete: false, missing: ['kịch bản không ghi key bật/tắt, cần file nghiệm thu (acceptance_path) để tra key (D-083)'] };
        }
        else {
            rk = { keys: [], complete: true, missing: [] };
            for (const resource of row.resources) {
                const lookup = acceptance.findKey({ resource, adsName: row.adsName, isHF: row.isHF });
                keyLookups.push({ row: row.row, resource, lookup });
                if (lookup.status === 'found')
                    rk.keys.push(lookup.key);
                else {
                    rk.complete = false;
                    rk.missing.push(`không tra được key của ${resource} trong file nghiệm thu: ${lookup.reason}`);
                }
            }
            rk.keys = [...new Set(rk.keys)];
        }
        rowKeys.set(row.row, rk);
    }
    const keysOf = (row) => rowKeys.get(row.row);
    // Nhiều dòng có thể dùng chung một ID (D-088): trạng thái của ID gộp theo mọi dòng dùng ID đó
    const rowsById = new Map();
    for (const row of script.rows) {
        let list = rowsById.get(row.adsId);
        if (!list)
            rowsById.set(row.adsId, (list = []));
        list.push(row);
    }
    const idStateAt = (id, prefs) => combine((rowsById.get(id) ?? []).map((r) => keyState(keysOf(r), prefs)));
    const idOverall = (id) => overallState((p) => idStateAt(id, p), snaps);
    const rowOverall = (row) => overallState((p) => keyState(keysOf(row), p), snaps);
    const sharedWith = (row) => (rowsById.get(row.adsId) ?? []).filter((r) => r.row !== row.row).map((r) => r.row);
    // ---- kiểm tra theo dòng
    const checkId = (row) => {
        const base = { check: 'id', evidence: [] };
        if (row.resourceSource !== 'resource') {
            return { ...base, status: 'NA', message: 'ad dùng Ads name thay resource nên không có key trong khối FO CONFIG CHECKLIST' };
        }
        if (!AD_ID_RE.test(row.adsId)) {
            return { ...base, status: 'REVIEW', message: 'kịch bản thiếu hoặc sai Ads ID, không đối chiếu được' };
        }
        const parts = [];
        for (const res of row.resources) {
            const values = [...new Set(snaps.filter((s) => res in s.checklist).map((s) => s.checklist[res]))];
            if (values.length === 0) {
                parts.push({ status: 'REVIEW', text: `${res}: không có trong FO CONFIG CHECKLIST của log` });
            }
            else if (values.length > 1) {
                parts.push({ status: 'REVIEW', text: `${res}: giá trị đổi giữa các lần in CONFIG` });
            }
            else if (values[0] === row.adsId) {
                parts.push({ status: 'OK', text: `${res}: khớp` });
            }
            else {
                parts.push({ status: 'FAIL', text: `${res}: kịch bản ${row.adsId}, log ${values[0] === '' ? '(trống)' : values[0]}` });
            }
        }
        const status = worst(parts.map((p) => p.status));
        const message = status === 'OK'
            ? `${parts.length} resource khớp ID trong log`
            : parts.filter((p) => p.status !== 'OK').map((p) => p.text).join('; ');
        return { ...base, status, message };
    };
    const checkPresent = (row) => {
        const base = { check: 'present', evidence: [] };
        if (!AD_ID_RE.test(row.adsId)) {
            return { ...base, status: 'REVIEW', message: 'kịch bản thiếu hoặc sai Ads ID, không đối chiếu được' };
        }
        const evs = eventsOf(row.adsId);
        if (evs.length > 0) {
            const c = (k) => evs.filter((e) => e.kind === k).length;
            return { ...base, status: 'OK', message: `có trong log: ${c('load_start')} lần load, ${c('load_fail')} fail, ${c('show')} show` };
        }
        const { keys, missing } = keysOf(row);
        if (idOverall(row.adsId) === 'disabled') {
            return { ...base, status: 'OK', message: `vắng mặt đúng vì key ${keys.join(', ')} = false (D-073)` };
        }
        // D-065: vắng mặt là FAIL; gợi ý thêm vì D-073 cho phép vắng mặt khi key = false
        const state = rowOverall(row);
        const hint = row.enableKeySource === 'ads_name'
            ? ' (key ad in-app chưa biết, cần console M4: nếu key = false thì vắng mặt là đúng)'
            : keys.length === 0
                ? ` (${missing[0] ?? 'kịch bản không ghi key bật/tắt'})`
                : state === 'enabled'
                    ? ` (key ${keys.join(', ')} = true)`
                    : state === 'disabled'
                        ? ` (key ${keys.join(', ')} = false nhưng ID dùng chung với dòng ${sharedWith(row).join(', ')} chưa tắt, D-088)`
                        : ` (chưa chắc key ${keys.join(', ')} bật hay tắt trong log${missing.length > 0 ? `; ${missing[0]}` : ''})`;
        return { ...base, status: 'FAIL', message: `không thấy trong log${hint}` };
    };
    const checkType = (row) => {
        const base = { check: 'type', evidence: [] };
        const logged = summaryOf(row.adsId);
        if (!logged)
            return { ...base, status: 'NA', message: 'ID không có trong log' };
        if (row.adsType === 'Unknown') {
            return { ...base, status: 'REVIEW', message: `Ads type "${row.adsTypeRaw || '(trống)'}" của kịch bản ngoài bảng ánh xạ` };
        }
        if (logged.adType === 'Unknown')
            return { ...base, status: 'REVIEW', message: 'loại ad trong log ngoài bảng ánh xạ' };
        return logged.adType === row.adsType
            ? { ...base, status: 'OK', message: `loại ${row.adsType} khớp log` }
            : { ...base, status: 'FAIL', message: `kịch bản ${row.adsType}, log ${logged.adType}` };
    };
    const perId = (row, check, fn, okMessage) => {
        const base = { check, evidence: [] };
        const evs = eventsOf(row.adsId);
        if (!AD_ID_RE.test(row.adsId) || evs.length === 0)
            return { ...base, status: 'NA', message: 'ID không có trong log' };
        const violations = fn(evs);
        return violations.length === 0
            ? { ...base, status: 'OK', message: okMessage }
            : { ...base, status: 'FAIL', message: `${violations.length} lần vi phạm`, evidence: sampleEvidence(violations) };
    };
    const checkKeyFalse = (row) => {
        const base = { check: 'key_false', evidence: [] };
        const evs = eventsOf(row.adsId);
        if (!AD_ID_RE.test(row.adsId) || evs.length === 0)
            return { ...base, status: 'NA', message: 'ID không có trong log' };
        const rk = keysOf(row);
        const { keys } = rk;
        if (keys.length === 0) {
            return {
                ...base,
                status: 'NA',
                message: row.enableKeySource === 'ads_name'
                    ? 'chưa kiểm, cần console (key ad in-app lấy từ Firebase, M4)'
                    : (rk.missing.join('; ') || 'kịch bản không ghi key bật/tắt'),
            };
        }
        if (!keys.some((k) => snaps.some((s) => k in s.prefs))) {
            return { ...base, status: 'NA', message: `key ${keys.join(', ')} không có trong Remote FO Prefs của log` };
        }
        // D-085: key = false thì ID không được load và không được show; trạng thái gộp theo ID (D-088)
        const violations = evs
            .filter((ev) => ev.kind === 'load_start' || ev.kind === 'show')
            .filter((ev) => idStateAt(row.adsId, snapshotAt(snaps, ev.time)?.prefs) === 'disabled')
            .map((ev) => `${ev.kind === 'show' ? 'show' : 'load'} lúc ${fmt(ev)} khi key ${keys.join(', ')} = false`);
        if (violations.length > 0) {
            return { ...base, status: 'FAIL', message: `key ${keys.join(', ')} = false nhưng ID vẫn được load hoặc show (${violations.length} lần)`, evidence: sampleEvidence(violations) };
        }
        if (!rk.complete && !snaps.some((s) => keyState(rk, s.prefs) === 'enabled')) {
            return { ...base, status: 'NA', message: `chưa đủ key để kết luận: ${rk.missing.join('; ')}` };
        }
        const shown = keys.map((k) => `${k}=${latest?.prefs[k] ?? '?'}`).join(', ');
        const shared = rowOverall(row) === 'disabled' && idOverall(row.adsId) !== 'disabled'
            ? `; key tắt nhưng ID dùng chung với dòng ${sharedWith(row).join(', ')} chưa tắt nên không kết luận theo dòng này (D-088)`
            : '';
        return { ...base, status: 'OK', message: `không có load hoặc show khi key tắt (${shown})${shared}` };
    };
    // ---- dựng kết quả từng dòng
    const rows = script.rows.map((row) => {
        const checks = [
            checkId(row),
            checkPresent(row),
            checkType(row),
            perId(row, 'fail_show', failThenShow, 'không có show sau load fail'),
            perId(row, 'load_once', loadMoreThanOnce, 'mỗi lần load đều có show hoặc fail trước lần load kế tiếp'),
            checkKeyFalse(row),
        ];
        return { row, status: 'OK', checks };
    });
    const verdictOf = new Map(rows.map((v) => [v.row.row, v]));
    // ---- rule HF trước (D-063 a, b, c), chỉ cho cặp đã ghép và không thuộc case đặc biệt
    const pairs = [];
    for (const v of rows) {
        const hf = v.row;
        if (!hf.isHF || hf.pairStatus !== 'paired' || hf.pairRow === undefined || hf.special)
            continue;
        const normal = verdictOf.get(hf.pairRow).row;
        const base = { check: 'hf_order', evidence: [] };
        let check;
        if (!AD_ID_RE.test(hf.adsId) || !AD_ID_RE.test(normal.adsId)) {
            check = { ...base, status: 'NA', message: 'thiếu Ads ID nên chưa kiểm rule HF' };
        }
        else {
            const [hfState, normalState] = [idOverall(hf.adsId), idOverall(normal.adsId)];
            const pairText = `cặp dòng ${hf.row} và ${normal.row}`;
            if (hfState === 'enabled' && normalState === 'enabled') {
                const violations = highFloorViolations(eventsOf(hf.adsId), eventsOf(normal.adsId));
                check =
                    violations.length === 0
                        ? { ...base, status: 'OK', message: `HF trước, ad thường sau đúng rule (${pairText})` }
                        : {
                            ...base,
                            status: 'FAIL',
                            message: `${violations.length} vi phạm rule HF (${pairText})${violations.some((v) => v.startsWith('(a)')) ? '; lưu ý D-087: ad thường được dùng lại cho màn khác có thể bị báo nhầm' : ''}`,
                            evidence: sampleEvidence(violations),
                        };
            }
            else if (hfState === 'disabled' && normalState === 'disabled') {
                check = { ...base, status: 'NA', message: `cả hai key = false, xem kiểm tra "key false" của từng dòng (${pairText})` };
            }
            else if (hfState !== 'unknown' && normalState !== 'unknown') {
                // D-085: một bên bật, một bên tắt: ad có key false phải bị bỏ qua, không load và không show
                const off = hfState === 'disabled' ? hf : normal;
                const offName = off === hf ? 'HF' : 'ad thường';
                const violations = eventsOf(off.adsId)
                    .filter((ev) => ev.kind === 'load_start' || ev.kind === 'show')
                    .map((ev) => `${offName} có key = false nhưng vẫn ${ev.kind === 'show' ? 'show' : 'load'} lúc ${fmt(ev)}`);
                check =
                    violations.length === 0
                        ? { ...base, status: 'OK', message: `chỉ ${off === hf ? 'ad thường' : 'HF'} bật, ${offName} (key false) đúng là không load và không show (${pairText})` }
                        : { ...base, status: 'FAIL', message: `${offName} có key = false nhưng vẫn được load hoặc show (${pairText})`, evidence: sampleEvidence(violations) };
            }
            else {
                const inApp = hf.enableKeySource === 'ads_name' || normal.enableKeySource === 'ads_name';
                const missing = [...keysOf(hf).missing, ...keysOf(normal).missing];
                check = {
                    ...base,
                    status: 'NA',
                    message: inApp
                        ? 'chưa kiểm, cần console (key ad in-app lấy từ Firebase, M4)'
                        : missing.length > 0
                            ? `chưa biết key bật/tắt của cặp: ${missing.join('; ')}`
                            : 'chưa biết key bật/tắt của cặp (không có trong Remote FO Prefs của log, hoặc đổi giữa các lần in CONFIG)',
                };
            }
        }
        v.checks.push(check);
        verdictOf.get(normal.row).checks.push({
            check: 'hf_order',
            status: 'NA',
            message: `cặp HF ở dòng ${hf.row}, xem kết quả ở dòng đó`,
            evidence: [],
        });
        const merged = [...eventsOf(hf.adsId), ...eventsOf(normal.adsId)].sort((a, b) => a.entryIndex - b.entryIndex);
        const lines = merged.slice(0, PAIR_LINES_MAX).map((e) => `${e.id === hf.adsId ? 'HF    ' : 'thường'} ${fmt(e)}`);
        if (merged.length > PAIR_LINES_MAX)
            lines.push(`... còn ${merged.length - PAIR_LINES_MAX} event nữa`);
        pairs.push({ hfRow: hf.row, normalRow: normal.row, status: check.status, note: check.message, lines });
    }
    // ---- chốt trạng thái; case đặc biệt luôn là CẦN XEM (D-075)
    for (const v of rows) {
        if (v.row.special) {
            v.special = buildSpecial(v, script, snaps, eventsOf, acceptance);
            v.status = 'REVIEW';
        }
        else {
            v.status = worst(v.checks.map((c) => c.status));
        }
    }
    // ---- ad có trong log nhưng không có trong sheet (D-065 chiều ngược lại)
    const scriptIds = new Set(script.rows.map((r) => r.adsId));
    const extras = log.ads.ads
        .filter((a) => !scriptIds.has(a.id))
        .map((a) => ({
        id: a.id,
        adType: a.adType,
        loadStart: a.loadStart,
        loadOk: a.loadOk,
        loadFail: a.loadFail,
        show: a.show,
        firstTime: a.firstTime,
        lastTime: a.lastTime,
    }));
    // ---- dòng load ok hoặc fail lẻ (D-086): không tính là request, cảnh báo kèm vị trí
    const logWarnings = [];
    for (const [id, evs] of byId) {
        for (const ev of loneResults(evs)) {
            logWarnings.push({
                id,
                kind: ev.kind,
                time: ev.time,
                line: ev.line,
                rows: (rowsById.get(id) ?? []).map((r) => ({ row: r.row, phase: r.phase, adsName: r.adsName })),
            });
        }
    }
    logWarnings.sort((a, b) => a.line - b.line);
    return {
        rows,
        extras,
        pairs,
        keyLookups,
        logWarnings,
        notes: buildNotes(script, log, rows, acceptance, keyLookups, logWarnings, rowKeys),
    };
}
// ------------------------------------------------------------ case đặc biệt (D-075, D-076, D-070)
function buildSpecial(v, script, snaps, eventsOf, acceptance) {
    const row = v.row;
    const sp = row.special;
    const latest = snaps[snaps.length - 1];
    let acc;
    if (!acceptance) {
        acc = { status: 'no_file', note: 'chưa có file nghiệm thu', excerpts: [] };
    }
    else if (!sp.acceptanceSection) {
        acc = { status: 'no_section_name', note: 'chưa xác định mục nghiệm thu của case này (src/data/special-cases.json)', excerpts: [] };
    }
    else {
        const excerpts = acceptance.extract(sp.acceptanceSection);
        acc =
            excerpts.length > 0
                ? { status: 'found', note: `mục "${sp.acceptanceSection}" trong sheet "${acceptance.sheet}"`, excerpts }
                : { status: 'not_found', note: `không thấy mục "${sp.acceptanceSection}" trong sheet "${acceptance.sheet}"`, excerpts: [] };
    }
    const names = [
        ...(row.resourceSource === 'resource' ? row.resources : []),
        ...(row.enableKeySource === 'ads_name' ? [] : row.enableKeys),
        ...sp.enableKeys,
        ...sp.relatedKeys,
        ...sp.identifiers.filter((i) => !i.endsWith('*')),
    ];
    const keyValues = [...new Set(names)].map((key) => {
        if (latest && key in latest.prefs)
            return { key, value: latest.prefs[key], source: 'prefs' };
        if (latest && key in latest.checklist)
            return { key, value: latest.checklist[key], source: 'checklist' };
        return { key, value: null, source: null };
    });
    const evs = eventsOf(row.adsId);
    const timeline = evs.slice(0, TIMELINE_MAX).map(fmt);
    if (evs.length > TIMELINE_MAX)
        timeline.push(`... còn ${evs.length - TIMELINE_MAX} event nữa`);
    return {
        name: sp.name,
        matchedBy: sp.matchedBy,
        acceptanceSection: sp.acceptanceSection,
        acceptance: acc,
        keyValues,
        idComparisons: sp.name === 'MIX' ? mixComparisons(row, script, latest) : [],
        timeline,
        generalChecks: v.checks.filter((c) => c.check !== 'hf_order'),
    };
}
/** So ID MIX theo D-070: so với ad tham chiếu trong kịch bản; kết quả chỉ để tester xem. */
function mixComparisons(row, script, latest) {
    const pickRow = (names) => script.rows.find((r) => names.includes(r.adsName.toLowerCase()));
    const specs = [
        { key: 'fo_na_mix_after_01', refs: ['native_full_fo_alt', 'native_splash'], fallback: ['native_ob_full_scr_2id'] },
        { key: 'fo_na_mix_after_01_2', refs: ['native_full_fo_alt_2id', 'native_splash_2id'] },
    ];
    const out = [];
    for (const spec of specs) {
        if (!row.resources.some((r) => r.toLowerCase() === spec.key))
            continue;
        const ref = pickRow(spec.refs) ?? (spec.fallback ? pickRow(spec.fallback) : undefined);
        const logged = latest?.checklist[spec.key];
        if (!ref) {
            out.push(`${spec.key}: kịch bản không có ad tham chiếu (${[...spec.refs, ...(spec.fallback ?? [])].join(' hoặc ')})`);
        }
        else if (logged === undefined) {
            out.push(`${spec.key}: không có trong FO CONFIG CHECKLIST của log`);
        }
        else {
            const same = logged === ref.adsId;
            out.push(`${spec.key}: log = ${logged || '(trống)'}; kịch bản (${ref.adsName}, dòng ${ref.row}) = ${ref.adsId} → ${same ? 'khớp' : 'LỆCH'}`);
        }
    }
    return out;
}
function buildNotes(script, log, rows, acceptance, keyLookups, logWarnings, rowKeys) {
    const notes = [];
    if (logWarnings.length > 0) {
        const sample = logWarnings
            .slice(0, 3)
            .map((w) => `dòng log ${w.line} (${w.time.slice(11)}) load ${w.kind === 'load_ok' ? 'ok' : 'fail'} của ${w.id}${w.rows.length > 0 ? ` (kịch bản dòng ${w.rows.map((r) => r.row).join(', ')})` : ''}`)
            .join('; ');
        notes.push(`Log có ${logWarnings.length} dòng load ok/fail lẻ, không có dòng "starting load" trước đó; không tính là request (D-086), cần xem: ${sample}${logWarnings.length > 3 ? '; ...' : ''}.`);
    }
    if (log.config.snapshots.length === 0) {
        notes.push('Log không có khối CONFIG: không kiểm được ID theo FO CONFIG CHECKLIST và key bật/tắt.');
    }
    else if (log.config.snapshots.length > 1) {
        notes.push(`Log có ${log.config.snapshots.length} lần in CONFIG (app khởi động lại): key bật/tắt tính theo lần in gần nhất trước mỗi event.`);
    }
    const inApp = rows.filter((r) => r.row.enableKeySource === 'ads_name' && !r.special).length;
    if (inApp > 0) {
        notes.push(`${inApp} ad in-app chưa kiểm được key bật/tắt và rule HF của cặp, cần console (key lấy từ Firebase theo condition Tester_<version>, M4).`);
    }
    const found = keyLookups.filter((k) => k.lookup.status === 'found').length;
    if (found > 0)
        notes.push(`${found} resource không ghi key trong kịch bản đã tra được key trong file nghiệm thu (D-083), xem report.`);
    const noKey = rows.filter((r) => !r.special && r.row.enableKeySource === 'none' && r.row.resourceSource === 'resource' && !rowKeys.get(r.row.row).complete).length;
    if (noKey > 0) {
        notes.push(acceptance
            ? `${noKey} ad có resource nhưng kịch bản không ghi key và chưa tra được key trong file nghiệm thu (D-083): kiểm tra cần key là NA, lý do trong report.`
            : `${noKey} ad có resource nhưng kịch bản không ghi key bật/tắt: truyền file nghiệm thu (acceptance_path) để tra key (D-083).`);
    }
    if (rows.some((r) => r.special) && !acceptance) {
        notes.push('Chưa có file nghiệm thu (acceptance_path): case đặc biệt chỉ kèm dữ liệu log, không có nguyên văn mục nghiệm thu.');
    }
    if (script.warnings.length > 0)
        notes.push(`Kịch bản có ${script.warnings.length} cảnh báo khi đọc (xem read_ad_script).`);
    return notes;
}
//# sourceMappingURL=verify.js.map