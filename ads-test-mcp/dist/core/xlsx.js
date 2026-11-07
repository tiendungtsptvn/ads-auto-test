import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ToolError } from './errors.js';
import { validateInputFile } from './validate.js';
import { ZipArchive } from './zip.js';
/**
 * Đọc file .xlsx / .xlsm (D-059) bằng ExcelJS ở chế độ đọc toàn bộ (không streaming).
 * Chỉ lấy giá trị ô đã lưu: không chạy macro, không tính lại công thức, không theo link ngoài.
 * Không dùng gói `xlsx` (SheetJS) trên npm.
 *
 * Trước khi đưa file cho ExcelJS có một bước kiểm tra riêng (`zip.ts`): nhận diện cấu trúc,
 * từ chối file có mật khẩu, giới hạn kích thước sau giải nén, và xác nhận mọi thành phần giải nén
 * đúng kích thước khai báo (chống zip bomb khai gian).
 */
export const MAX_CELLS = 2_000_000;
const ALLOWED_EXT = new Set(['.xlsx', '.xlsm']);
/** Số cột từ chữ cái: A=1, Z=26, AA=27. */
export function colIndex(letters) {
    let n = 0;
    for (const ch of letters.toUpperCase()) {
        const c = ch.charCodeAt(0) - 64;
        if (c < 1 || c > 26)
            return NaN;
        n = n * 26 + c;
    }
    return n;
}
/** Chữ cái cột từ số: 1=A, 27=AA. */
export function colLabel(index) {
    let s = '';
    for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}
/** Bỏ ký tự vô hình hay gặp khi copy từ web, chuẩn hóa xuống dòng, cắt khoảng trắng đầu cuối. */
export function normalizeCellText(s) {
    return s
        .replace(/[​-‍⁠﻿]/g, '')
        .replace(/ /g, ' ')
        .replace(/\r\n|\r/g, '\n')
        .trim();
}
export class XlsxWorkbook {
    wb;
    sheets;
    constructor(wb) {
        this.wb = wb;
        this.sheets = wb.worksheets.map((ws) => ({
            name: ws.name,
            state: ws.state === 'hidden' || ws.state === 'veryHidden' ? ws.state : 'visible',
        }));
    }
    /** Mở file theo đường dẫn tuyệt đối: kiểm tra đường dẫn, đuôi file, kích thước, rồi đọc. */
    static async open(xlsxPath) {
        const file = validateInputFile(xlsxPath, 'xlsx_path');
        if (!ALLOWED_EXT.has(path.extname(file).toLowerCase())) {
            throw new ToolError('xlsx_path phải là file .xlsx hoặc .xlsm.');
        }
        let buf;
        try {
            buf = fs.readFileSync(file);
        }
        catch {
            throw new ToolError('Không đọc được file Excel. Kiểm tra quyền truy cập.');
        }
        return XlsxWorkbook.fromBuffer(buf);
    }
    static async fromBuffer(buf) {
        preflight(buf);
        const wb = new ExcelJS.Workbook();
        try {
            await wb.xlsx.load(buf);
        }
        catch (err) {
            console.error('[ads-test-mcp] ExcelJS không đọc được file:', err instanceof Error ? err.message : err);
            throw new ToolError('Không đọc được file Excel (file hỏng hoặc không đúng định dạng xlsx).');
        }
        if (wb.worksheets.length === 0)
            throw new ToolError('File xlsx không có sheet nào.');
        let total = 0;
        for (const ws of wb.worksheets) {
            ws.eachRow({ includeEmpty: false }, (row) => {
                total += row.actualCellCount;
            });
        }
        if (total > MAX_CELLS) {
            throw new ToolError(`File vượt giới hạn ${MAX_CELLS.toLocaleString('en-US')} ô có dữ liệu.`);
        }
        return new XlsxWorkbook(wb);
    }
    /** Đọc các ô có giá trị của một sheet theo tên chính xác. */
    readSheet(name) {
        const ws = this.wb.getWorksheet(name);
        if (!ws)
            throw new ToolError('Không có sheet với tên đã cho.');
        const rows = new Map();
        let maxRow = 0;
        let cellCount = 0;
        ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            row.eachCell({ includeEmpty: false }, (cell, col) => {
                // Ô con của vùng gộp mang lại giá trị của ô chính; bỏ đi để mỗi giá trị chỉ xuất hiện một lần.
                if (cell.type === ExcelJS.ValueType.Merge || cell.type === ExcelJS.ValueType.Error)
                    return;
                const text = normalizeCellText(cellText(cell));
                if (text === '')
                    return;
                let r = rows.get(rowNumber);
                if (!r) {
                    r = new Map();
                    rows.set(rowNumber, r);
                }
                r.set(col, text);
                cellCount++;
                if (rowNumber > maxRow)
                    maxRow = rowNumber;
            });
        });
        return { name: ws.name, rows, maxRow, cellCount };
    }
}
/**
 * Chuyển giá trị ô của ExcelJS thành chuỗi. Không dùng `cell.text` vì với ô hyperlink có chữ rich text
 * nó trả về object. Công thức lấy kết quả đã lưu; lỗi công thức (#N/A, ...) coi như trống.
 */
export function valueToText(v, depth = 0) {
    if (v === null || v === undefined || depth > 4)
        return '';
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number')
        return String(v);
    if (typeof v === 'boolean')
        return v ? 'TRUE' : 'FALSE';
    if (v instanceof Date)
        return Number.isNaN(v.getTime()) ? '' : v.toISOString();
    if (typeof v === 'object') {
        const o = v;
        if (Array.isArray(o.richText)) {
            return o.richText.map((r) => valueToText(r.text, depth + 1)).join('');
        }
        if ('error' in o)
            return '';
        if ('result' in o)
            return valueToText(o.result, depth + 1);
        if ('text' in o)
            return valueToText(o.text, depth + 1);
    }
    return '';
}
function cellText(cell) {
    return valueToText(cell.value);
}
/** Kiểm tra cấu trúc và giới hạn trước khi giải mã bằng ExcelJS. */
function preflight(buf) {
    assertZipMagic(buf);
    const zip = ZipArchive.open(buf);
    if (!zip.has('[Content_Types].xml') || !zip.has('xl/workbook.xml')) {
        throw new ToolError('File không phải xlsx hợp lệ (thiếu cấu trúc workbook).');
    }
    // Giải nén thử từng thành phần có giới hạn: kích thước thực tế phải khớp khai báo.
    for (const name of zip.names())
        zip.read(name);
}
/** Phân biệt zip (xlsx), file Office cũ hoặc có mật khẩu (OLE) và file không phải xlsx. */
function assertZipMagic(buf) {
    const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5);
    if (isZip)
        return;
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (buf.length >= 8 && ole.every((b, i) => buf[i] === b)) {
        throw new ToolError('File có mật khẩu hoặc là định dạng Excel cũ (.xls), không đọc được. Bỏ mật khẩu hoặc lưu lại thành .xlsx.');
    }
    throw new ToolError('File không phải xlsx hợp lệ.');
}
//# sourceMappingURL=xlsx.js.map