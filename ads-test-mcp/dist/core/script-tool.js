import { readAdScript } from './ad-script.js';
import { ToolError } from './errors.js';
import { XlsxWorkbook } from './xlsx.js';
export const SCRIPT_LIMIT_DEFAULT = 10;
export const SCRIPT_LIMIT_MAX = 50;
export const MAX_WARNING_ITEMS = 8;
const MAX_SHEETS_LISTED = 20;
const NAME_MAX = 60;
function cut(s, max) {
    return s.length > max ? `${s.slice(0, max)}...` : s;
}
/** Danh sách sheet để đưa vào thông báo lỗi: sheet hiện trước, tối đa 20, tên cắt ngắn. */
function describeSheets(sheets) {
    const sorted = [...sheets].sort((a, b) => Number(a.state !== 'visible') - Number(b.state !== 'visible'));
    const names = sorted
        .slice(0, MAX_SHEETS_LISTED)
        .map((s) => `"${cut(s.name, NAME_MAX)}"${s.state === 'visible' ? '' : ' (ẩn)'}`);
    const more = sheets.length > MAX_SHEETS_LISTED ? `, ... (${sheets.length} sheet)` : '';
    return names.join(', ') + more;
}
/**
 * Chọn sheet (D-071): file chỉ có một sheet thì bỏ qua tham số; nhiều sheet mà thiếu hoặc sai tên
 * thì báo lỗi kèm danh sách sheet.
 */
export function pickSheet(sheets, requested) {
    if (sheets.length === 1)
        return sheets[0].name;
    if (requested === undefined) {
        throw new ToolError(`File có ${sheets.length} sheet, cần truyền tham số sheet. Các sheet: ${describeSheets(sheets)}.`);
    }
    if (!sheets.some((s) => s.name === requested)) {
        throw new ToolError(`Không có sheet "${cut(requested, NAME_MAX)}". Các sheet: ${describeSheets(sheets)}.`);
    }
    return requested;
}
export async function loadAdScript(xlsxPath, sheet) {
    const wb = await XlsxWorkbook.open(xlsxPath);
    const name = pickSheet(wb.sheets, sheet);
    return { script: readAdScript(wb.readSheet(name)), sheets: wb.sheets };
}
function toRow(r) {
    return {
        row: r.row,
        phase: cut(r.phase, NAME_MAX),
        screen: cut(r.screen, 40),
        name: cut(r.adsName, NAME_MAX),
        res: r.resources.slice(0, 6).map((x) => cut(x, 80)),
        keys: r.enableKeys.slice(0, 6).map((x) => cut(x, 80)),
        type: r.adsType,
        id: cut(r.adsId, 60),
        ...(r.isHF ? { hf: true } : {}),
        ...(r.pairStatus ? { pair_status: r.pairStatus } : {}),
        ...(r.pairRow !== undefined ? { pair_row: r.pairRow } : {}),
        ...(r.pairedWith ? { paired_with: r.pairedWith } : {}),
        ...(r.special ? { special: r.special.name } : {}),
        ...(r.resourceSource === 'ads_name' ? { src: 'ads_name' } : {}),
        ...(r.note !== undefined ? { note: cut(r.note, NAME_MAX) } : {}),
    };
}
const normPhase = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
export function buildScriptResult(script, sheets, opts = {}) {
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? SCRIPT_LIMIT_DEFAULT;
    let selected = script.rows;
    let filter = null;
    if (opts.phase !== undefined) {
        const want = normPhase(opts.phase);
        const phase = script.phases.find((p) => normPhase(p.name) === want);
        if (!phase) {
            const names = script.phases.map((p) => `"${cut(p.name, NAME_MAX)}"`).join(', ');
            throw new ToolError(`Không có mục phase "${cut(opts.phase, NAME_MAX)}". Các mục phase: ${names}.`);
        }
        selected = script.rows.filter((r) => r.phase === phase.name);
        filter = phase.name;
    }
    const hf = script.rows.filter((r) => r.isHF);
    const count = (s) => hf.filter((r) => r.pairStatus === s).length;
    return {
        sheet: cut(script.sheet, NAME_MAX),
        sheets: sheets.slice(0, MAX_SHEETS_LISTED).map((s) => ({ name: cut(s.name, NAME_MAX), state: s.state })),
        header_row: script.headerRow,
        phases: script.phases.map((p) => ({ name: cut(p.name, NAME_MAX), row: p.row, ads: p.ads })),
        counts: {
            ads: script.rows.length,
            hf: hf.length,
            paired: count('paired'),
            unpaired: count('unpaired'),
            ambiguous: count('ambiguous'),
            special: script.rows.filter((r) => r.special).length,
            name_as_resource: script.rows.filter((r) => r.resourceSource === 'ads_name').length,
        },
        ads: {
            total: selected.length,
            filter_phase: filter,
            offset,
            rows: selected.slice(offset, offset + limit).map(toRow),
            next_offset: offset + limit < selected.length ? offset + limit : null,
        },
        warnings: {
            total: script.warnings.length,
            items: script.warnings.slice(0, MAX_WARNING_ITEMS).map((w) => ({
                row: w.row,
                code: w.code,
                message: cut(w.message, 160),
            })),
        },
    };
}
//# sourceMappingURL=script-tool.js.map