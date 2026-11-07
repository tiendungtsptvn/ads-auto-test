export interface ExcerptLine {
    /** Số dòng trong sheet nghiệm thu (từ 1). */
    row: number;
    /** Các ô có dữ liệu: nhãn cột (theo dòng tiêu đề) và nguyên văn, đã cắt độ dài. */
    cells: Array<{
        label: string;
        ref: string;
        text: string;
    }>;
}
export interface AcceptanceExcerpt {
    sheet: string;
    /** Tên mục (dòng đầu của ô "Tên ad"). */
    section: string;
    startRow: number;
    lines: ExcerptLine[];
}
export interface KeyQuery {
    /** Resource name, tra trước. */
    resource: string;
    /** Ads name, chỉ tra khi resource không có trong mục nào. */
    adsName: string;
    isHF: boolean;
}
export type KeyLookup = {
    status: 'found';
    key: string;
    by: 'resource' | 'ads_name';
    needle: string;
    section: string;
    ref: string;
} | {
    status: 'not_found' | 'ambiguous' | 'unclear';
    reason: string;
};
export interface Acceptance {
    sheet: string;
    /** Trích các mục có tên khớp (không phân biệt hoa thường, so với dòng đầu của ô "Tên ad"). */
    extract(section: string): AcceptanceExcerpt[];
    /** Tra key remote của một ad theo resource name, rồi Ads name (D-083). Không đoán: thiếu dữ kiện thì trả lý do. */
    findKey(query: KeyQuery): KeyLookup;
}
/**
 * Lấy key của một ad từ ô "Key remote" của mục nghiệm thu (D-089):
 *  (1) dòng dạng `key: tắt ad` là key của ad thường, `key: tắt 2f` là key của ad HF;
 *  (2) không có ghi chú đó thì tìm đúng một cặp `X` và `X_2ID`: `X_2ID` của ad HF, `X` của ad thường;
 *  (3) còn lại không kết luận.
 */
export declare function keyFromCell(text: string, isHF: boolean): {
    key: string;
} | {
    reason: string;
};
export declare function readAcceptance(path: unknown, sheetName: string | undefined): Promise<Acceptance>;
