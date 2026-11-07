import { ToolError } from './errors.js';
import { colLabel, XlsxWorkbook } from './xlsx.js';
/**
 * Đọc file nghiệm thu tích hợp lib (tùy chọn, D-076) chỉ để trích **nguyên văn** mô tả của case đặc biệt.
 * Tool không diễn giải nội dung này. Bố cục theo file mẫu: dòng tiêu đề có cột "Tên ad"; mỗi mục bắt đầu ở
 * dòng có cột "Tên ad" khác trống và kéo dài đến dòng kế tiếp có cột đó khác trống.
 */
const MAX_BLOCK_ROWS = 40;
const CELL_MAX = 700;
const MAX_EXCERPTS_PER_SECTION = 4;
function cut(s) {
    return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}...` : s;
}
function firstLine(s) {
    return s.split('\n')[0].trim();
}
const TOKEN_SPLIT = /[^A-Za-z0-9_]+/;
const KEY_NAME = /^[A-Za-z0-9_]+$/;
function tokens(text) {
    return new Set(text.toLowerCase().split(TOKEN_SPLIT).filter((t) => t !== ''));
}
/**
 * Lấy key của một ad từ ô "Key remote" của mục nghiệm thu (D-089):
 *  (1) dòng dạng `key: tắt ad` là key của ad thường, `key: tắt 2f` là key của ad HF;
 *  (2) không có ghi chú đó thì tìm đúng một cặp `X` và `X_2ID`: `X_2ID` của ad HF, `X` của ad thường;
 *  (3) còn lại không kết luận.
 */
export function keyFromCell(text, isHF) {
    const lines = text
        .normalize('NFC')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '');
    const marked = { hf: [], normal: [] };
    for (const line of lines) {
        const m = /^([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(line);
        if (!m)
            continue;
        const desc = m[2].toLowerCase();
        if (/tắt\s*2f/.test(desc))
            marked.hf.push(m[1]);
        else if (/tắt\s*ad/.test(desc))
            marked.normal.push(m[1]);
    }
    const side = isHF ? 'ad HF ("tắt 2f")' : 'ad thường ("tắt ad")';
    if (marked.hf.length + marked.normal.length > 0) {
        const pick = isHF ? marked.hf : marked.normal;
        if (pick.length === 1)
            return { key: pick[0] };
        return { reason: pick.length === 0 ? `ô Key remote không có key ghi cho ${side}` : `ô Key remote có ${pick.length} key ghi cho ${side}` };
    }
    const names = lines.filter((l) => KEY_NAME.test(l));
    const lower = new Set(names.map((n) => n.toLowerCase()));
    const pairs = names.filter((n) => /_2id$/i.test(n) && lower.has(n.slice(0, -4).toLowerCase()));
    if (pairs.length === 1) {
        const hfKey = pairs[0];
        const normalKey = names.find((n) => n.toLowerCase() === hfKey.slice(0, -4).toLowerCase());
        return { key: isHF ? hfKey : normalKey };
    }
    return {
        reason: pairs.length > 1
            ? 'ô Key remote có nhiều cặp key X và X_2ID, không rõ cặp nào của ad này'
            : 'ô Key remote không ghi "tắt ad"/"tắt 2f" và không có cặp key X và X_2ID',
    };
}
function findHeader(sheet) {
    const last = Math.min(sheet.maxRow, 200);
    for (let r = 1; r <= last; r++) {
        const cells = sheet.rows.get(r);
        if (!cells)
            continue;
        for (const [col, text] of cells) {
            if (/^tên ad$/i.test(firstLine(text))) {
                const labels = new Map();
                for (const [c, t] of cells)
                    labels.set(c, firstLine(t));
                return { row: r, nameCol: col, labels };
            }
        }
    }
    throw new ToolError('Không tìm thấy dòng tiêu đề có cột "Tên ad" trong sheet nghiệm thu. Kiểm tra lại sheet đã chọn.');
}
/** Sheet nghiệm thu mặc định là sheet hiện duy nhất; có nhiều sheet hiện mà thiếu tham số thì báo lỗi. */
function pickAcceptanceSheet(sheets, requested) {
    if (requested !== undefined) {
        if (!sheets.some((s) => s.name === requested)) {
            throw new ToolError(`Không có sheet nghiệm thu "${requested.slice(0, 60)}". Các sheet: ${list(sheets)}.`);
        }
        return requested;
    }
    const visible = sheets.filter((s) => s.state === 'visible');
    if (visible.length === 1)
        return visible[0].name;
    throw new ToolError(`File nghiệm thu có ${visible.length} sheet hiện, cần truyền acceptance_sheet. Các sheet: ${list(sheets)}.`);
}
function list(sheets) {
    return sheets
        .slice(0, 20)
        .map((s) => `"${s.name.slice(0, 60)}"${s.state === 'visible' ? '' : ' (ẩn)'}`)
        .join(', ');
}
export async function readAcceptance(path, sheetName) {
    const wb = await XlsxWorkbook.open(path);
    const name = pickAcceptanceSheet(wb.sheets, sheetName);
    const sheet = wb.readSheet(name);
    const header = findHeader(sheet);
    const sectionStarts = [];
    for (let r = header.row + 1; r <= sheet.maxRow; r++) {
        if (sheet.rows.get(r)?.get(header.nameCol))
            sectionStarts.push(r);
    }
    const keyCol = [...header.labels].find(([, label]) => /^key remote$/i.test(label))?.[0];
    const sections = sectionStarts.map((start, i) => {
        const end = (sectionStarts[i + 1] ?? sheet.maxRow + 1) - 1;
        const rowTokens = [];
        for (let r = start; r <= end; r++) {
            const cells = sheet.rows.get(r);
            if (!cells)
                continue;
            const text = [...cells]
                .filter(([col]) => {
                const label = header.labels.get(col);
                return label !== undefined && !/ví dụ log/i.test(label);
            })
                .map(([, t]) => t)
                .join('\n');
            rowTokens.push({ row: r, tokens: tokens(text) });
        }
        return { start, title: firstLine(sheet.rows.get(start).get(header.nameCol)), rowTokens };
    });
    const lookup = (needle, by, isHF) => {
        const want = needle.toLowerCase();
        const hits = sections
            .map((sec) => ({ sec, rows: sec.rowTokens.filter((t) => t.tokens.has(want)).map((t) => t.row) }))
            .filter((h) => h.rows.length > 0);
        const what = by === 'resource' ? `resource "${needle}"` : `Ads name "${needle}"`;
        if (hits.length === 0)
            return { status: 'not_found', reason: `không có mục nào trong sheet nghiệm thu "${name}" nhắc tới ${what}` };
        if (hits.length > 1) {
            return {
                status: 'ambiguous',
                reason: `${what} có ở ${hits.length} mục nghiệm thu (${hits.map((h) => `"${h.sec.title}" dòng ${h.sec.start}`).join(', ')})`,
            };
        }
        const { sec, rows } = hits[0];
        if (keyCol === undefined)
            return { status: 'unclear', reason: `sheet nghiệm thu "${name}" không có cột "Key remote"` };
        // Ô Key remote cùng dòng với chỗ nhắc tới; trống thì lấy dòng đầu mục
        const keyRows = [...new Set(rows.map((r) => (sheet.rows.get(r)?.get(keyCol) ? r : sec.start)))];
        const results = keyRows.map((r) => ({ r, out: keyFromCell(sheet.rows.get(r)?.get(keyCol) ?? '', isHF) }));
        const keys = [...new Set(results.flatMap((x) => ('key' in x.out ? [x.out.key] : [])))];
        const where = `mục "${sec.title}" (dòng ${sec.start})`;
        if (keys.length === 1 && results.every((x) => 'key' in x.out)) {
            return { status: 'found', key: keys[0], by, needle, section: sec.title, ref: `${colLabel(keyCol)}${results[0].r}` };
        }
        if (keys.length > 1)
            return { status: 'ambiguous', reason: `${where} cho ra nhiều key (${keys.join(', ')})` };
        const first = results.find((x) => 'reason' in x.out);
        return { status: 'unclear', reason: `${where}, ô ${colLabel(keyCol)}${first.r}: ${first.out.reason}` };
    };
    return {
        sheet: name,
        findKey({ resource, adsName, isHF }) {
            const byResource = lookup(resource, 'resource', isHF);
            if (byResource.status !== 'not_found' || adsName.trim() === '')
                return byResource;
            const byName = lookup(adsName.trim(), 'ads_name', isHF);
            return byName.status === 'not_found' ? { status: 'not_found', reason: `${byResource.reason}; Ads name "${adsName}" cũng không có` } : byName;
        },
        extract(section) {
            const want = section.trim().toLowerCase();
            const out = [];
            for (const start of sectionStarts) {
                const title = firstLine(sheet.rows.get(start).get(header.nameCol));
                if (title.toLowerCase() !== want)
                    continue;
                const next = sectionStarts.find((s) => s > start) ?? sheet.maxRow + 1;
                const end = Math.min(next - 1, start + MAX_BLOCK_ROWS - 1);
                const lines = [];
                for (let r = start; r <= end; r++) {
                    const cells = sheet.rows.get(r);
                    if (!cells)
                        continue;
                    const parts = [];
                    for (const [col, text] of [...cells].sort((a, b) => a[0] - b[0])) {
                        const label = header.labels.get(col);
                        // Chỉ lấy các cột có tên trong dòng tiêu đề; bỏ cột ví dụ log (đường link ảnh chụp màn hình)
                        if (!label || /ví dụ log/i.test(label))
                            continue;
                        parts.push({ label, ref: `${colLabel(col)}${r}`, text: cut(text) });
                    }
                    if (parts.length > 0)
                        lines.push({ row: r, cells: parts });
                }
                out.push({ sheet: name, section: title, startRow: start, lines });
                if (out.length >= MAX_EXCERPTS_PER_SECTION)
                    break;
            }
            return out;
        },
    };
}
//# sourceMappingURL=acceptance.js.map