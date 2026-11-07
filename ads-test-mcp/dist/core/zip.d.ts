/**
 * Đọc file zip tối thiểu cho .xlsx: chỉ dùng `node:zlib`, không dependency (D-062).
 * Chỉ đọc, không giải nén ra đĩa. Không hỗ trợ zip64, mã hóa, hay phương thức nén khác stored/deflate.
 */
export interface ZipLimits {
    maxEntries: number;
    /** Kích thước tối đa của một entry sau giải nén. */
    maxEntryBytes: number;
    /** Tổng kích thước khai báo sau giải nén của mọi entry. */
    maxTotalBytes: number;
}
export declare const DEFAULT_ZIP_LIMITS: ZipLimits;
export declare class ZipArchive {
    private readonly buf;
    private readonly limits;
    private readonly entries;
    private constructor();
    static open(buf: Buffer, limits?: ZipLimits): ZipArchive;
    has(name: string): boolean;
    names(): string[];
    /** Đọc và giải nén một entry. Kích thước thực tế phải khớp khai báo (chống zip bomb khai gian). */
    read(name: string): Buffer;
    private parseDirectory;
    private findEocd;
}
