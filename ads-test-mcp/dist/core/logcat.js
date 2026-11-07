import { ToolError } from './errors.js';
const ENTRY_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)-(\d+)\s+(\S+)\s+(\S+)\s+([VDIWEFA])\s+(.*)$/;
export const TESTER_TAG_PREFIX = 'FOR_TESTER_';
/** Số dòng không-thụt-lề đầu file dùng để kiểm tra định dạng. */
const FORMAT_PROBE_LINES = 30;
export function splitLines(text) {
    const lines = text.split(/\r\n|\n|\r/);
    if (lines.length > 0 && lines[lines.length - 1] === '')
        lines.pop();
    return lines;
}
/** Text của một entry (dòng đầu cộng các dòng tiếp theo). */
export function entryText(e) {
    return e.extra.length === 0 ? e.message : `${e.message}\n${e.extra.join('\n')}`;
}
/** Chuyển "YYYY-MM-DD HH:MM:SS.mmm" thành mili giây, coi như giờ UTC để so sánh tương đối. */
export function timeToMs(time) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(time);
    if (!m)
        return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
}
export function parseLogcat(text) {
    const lines = splitLines(text);
    assertLogcatFormat(lines);
    const entries = [];
    let unparsed = 0;
    let current;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const m = ENTRY_RE.exec(raw);
        if (m) {
            current = {
                index: entries.length,
                line: i + 1,
                time: m[1],
                pid: Number(m[2]),
                tid: Number(m[3]),
                tag: m[4],
                pkg: m[5],
                level: m[6],
                message: m[7].trim(),
                extra: [],
            };
            entries.push(current);
            continue;
        }
        if (raw.trim() === '')
            continue;
        if (current && /^\s/.test(raw)) {
            current.extra.push(raw.trim());
        }
        else {
            unparsed++;
        }
    }
    return { entries, totalLines: lines.length, unparsedLines: unparsed };
}
/**
 * Kiểm tra vài chục dòng đầu: nếu quá nửa dòng không thụt lề không khớp định dạng
 * Android Studio thì báo lỗi, không in nội dung file (mvp.md, "Quy tắc đầu vào").
 */
function assertLogcatFormat(lines) {
    let probed = 0;
    let matched = 0;
    for (const raw of lines) {
        if (raw.trim() === '' || /^\s/.test(raw))
            continue;
        probed++;
        if (ENTRY_RE.test(raw))
            matched++;
        if (probed >= FORMAT_PROBE_LINES)
            break;
    }
    if (probed === 0 || matched * 2 < probed) {
        throw new ToolError('File không đúng định dạng logcat xuất từ Android Studio ' +
            '(mỗi dòng cần có ngày giờ, pid-tid, tag, package, mức log). Kiểm tra lại file đã chọn.');
    }
}
export function matchesFilter(e, f) {
    if (f.tag) {
        const want = f.tag.toUpperCase();
        const have = e.tag.toUpperCase();
        if (have !== want && have !== `${TESTER_TAG_PREFIX}${want}`)
            return false;
    }
    if (f.text || f.adId) {
        const text = entryText(e);
        if (f.text && !text.toLowerCase().includes(f.text.toLowerCase()))
            return false;
        if (f.adId && !text.includes(f.adId))
            return false;
    }
    return true;
}
//# sourceMappingURL=logcat.js.map