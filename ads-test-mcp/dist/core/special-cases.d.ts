/** Case đặc biệt khai báo trong `src/data/special-cases.json` (D-077). */
export interface SpecialCase {
    name: string;
    identifiers: string[];
    acceptanceSection: string | null;
    /** Key bật/tắt ad của case khi kịch bản không ghi key (ví dụ MIX tắt bằng `fo_inter_splash`, D-070). */
    enableKeys?: string[];
    /** Key liên quan, chỉ để hiển thị giá trị trong log. */
    relatedKeys?: string[];
}
export interface SpecialMatch {
    name: string;
    /** Identifier trong file dữ liệu đã khớp. */
    matchedBy: string;
    acceptanceSection: string | null;
    /** Toàn bộ identifier của case (tên key không có dấu `*` được dùng để hiển thị giá trị trong log). */
    identifiers: string[];
    enableKeys: string[];
    relatedKeys: string[];
}
export declare const SPECIAL_CASES: readonly SpecialCase[];
/**
 * Tìm case đặc biệt của một ad theo các tên nhận diện (resource name, enable key, Ads name).
 * Trả về case đầu tiên khớp theo thứ tự trong file dữ liệu.
 */
export declare function matchSpecialCase(names: readonly string[], cases?: readonly SpecialCase[]): SpecialMatch | undefined;
