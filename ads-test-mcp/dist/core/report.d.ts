import { type RowKeyMap } from './key-map.js';
import { type VerifyResult } from './verify.js';
/**
 * Report đối chiếu dạng Markdown kèm front-matter (D-056). Chỉ là bằng chứng; kết luận đạt hay không đạt
 * do tester quyết định. Mọi chuỗi lấy từ file log, kịch bản, nghiệm thu là dữ liệu không đáng tin cậy:
 * được làm sạch (bỏ ký tự điều khiển, escape HTML và dấu `|`) và cắt độ dài trước khi vào report.
 */
export interface ReportMeta {
    generatedAt: Date;
    packageName: string;
    libVersion: string | null;
    logFile: string;
    logFirst: string;
    logLast: string;
    scriptFile: string;
    sheet: string;
    acceptanceFile?: string;
    acceptanceSheet?: string;
}
/** Làm sạch một chuỗi lấy từ dữ liệu ngoài để đặt vào Markdown một dòng. */
export declare function md(s: string, max?: number, keepBreaks?: boolean): string;
export declare const code: (s: string, max?: number) => string;
/** `YYYYMMDD-HHMMSS` theo giờ máy. */
export declare function stamp(d: Date): string;
export declare function renderReport(result: VerifyResult, meta: ReportMeta): string;
/** Bảng mapping key: một dòng cho mỗi ad, dùng chung cho report verify và report key-map. */
export declare function keyMapTable(rows: readonly RowKeyMap[], condition: string): string[];
/** Kiểm tra thư mục đích: tuyệt đối, tồn tại, là thư mục thật (không phải symlink). */
export declare function validateOutDir(raw: unknown): string;
/**
 * Ghi report ra thư mục: ghi tạm trong cùng thư mục rồi liên kết sang tên cuối, nên không bao giờ ghi
 * đè file đã có (trùng tên thì thêm hậu tố -2, -3, ...). Trả về đường dẫn tuyệt đối của report.
 */
export declare function writeReport(dir: string, content: string, now: Date, prefix?: string): string;
