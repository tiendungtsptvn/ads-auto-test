/**
 * Đọc file .xlsx / .xlsm (D-059) bằng ExcelJS ở chế độ đọc toàn bộ (không streaming).
 * Chỉ lấy giá trị ô đã lưu: không chạy macro, không tính lại công thức, không theo link ngoài.
 * Không dùng gói `xlsx` (SheetJS) trên npm.
 *
 * Trước khi đưa file cho ExcelJS có một bước kiểm tra riêng (`zip.ts`): nhận diện cấu trúc,
 * từ chối file có mật khẩu, giới hạn kích thước sau giải nén, và xác nhận mọi thành phần giải nén
 * đúng kích thước khai báo (chống zip bomb khai gian).
 */
export declare const MAX_CELLS = 2000000;
export interface SheetInfo {
    name: string;
    state: 'visible' | 'hidden' | 'veryHidden';
}
export interface SheetData {
    name: string;
    /** Hàng (từ 1) -> cột (từ 1) -> giá trị đã chuẩn hóa. Chỉ chứa ô có giá trị. */
    rows: Map<number, Map<number, string>>;
    maxRow: number;
    cellCount: number;
}
/** Số cột từ chữ cái: A=1, Z=26, AA=27. */
export declare function colIndex(letters: string): number;
/** Chữ cái cột từ số: 1=A, 27=AA. */
export declare function colLabel(index: number): string;
/** Bỏ ký tự vô hình hay gặp khi copy từ web, chuẩn hóa xuống dòng, cắt khoảng trắng đầu cuối. */
export declare function normalizeCellText(s: string): string;
export declare class XlsxWorkbook {
    private readonly wb;
    readonly sheets: SheetInfo[];
    private constructor();
    /** Mở file theo đường dẫn tuyệt đối: kiểm tra đường dẫn, đuôi file, kích thước, rồi đọc. */
    static open(xlsxPath: unknown): Promise<XlsxWorkbook>;
    static fromBuffer(buf: Buffer): Promise<XlsxWorkbook>;
    /** Đọc các ô có giá trị của một sheet theo tên chính xác. */
    readSheet(name: string): SheetData;
}
/**
 * Chuyển giá trị ô của ExcelJS thành chuỗi. Không dùng `cell.text` vì với ô hyperlink có chữ rich text
 * nó trả về object. Công thức lấy kết quả đã lưu; lỗi công thức (#N/A, ...) coi như trống.
 */
export declare function valueToText(v: unknown, depth?: number): string;
