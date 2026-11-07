/** Giới hạn kích thước mặc định của file đầu vào (mvp.md, mục "Quy tắc đầu vào"). */
export declare const MAX_FILE_BYTES: number;
/**
 * Kiểm tra đường dẫn do người dùng truyền vào: tuyệt đối, chuẩn hóa, là file thường,
 * không phải symlink, không vượt giới hạn kích thước. Trả về đường dẫn đã chuẩn hóa.
 */
export declare function validateInputFile(rawPath: unknown, label: string, maxBytes?: number): string;
/**
 * Đọc file text, xử lý BOM (UTF-8, UTF-16 LE/BE) và UTF-16 không BOM.
 * CRLF được chuẩn hóa khi tách dòng, ở tầng parser.
 */
export declare function readTextFile(filePath: string): string;
export declare function decodeText(buf: Buffer): string;
