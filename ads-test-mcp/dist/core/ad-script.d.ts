import { type AdType } from './ad-events.js';
import { type SpecialMatch } from './special-cases.js';
import { type SheetData } from './xlsx.js';
/**
 * Chuẩn hóa một sheet kịch bản ads (M2). Rule lấy từ các quyết định D-064, D-067, D-069, D-071 đến D-075.
 * Gặp tình huống rule chưa nói tới thì không đoán: giữ nguyên dữ liệu và thêm cảnh báo.
 */
export type PairStatus = 'paired' | 'special_case' | 'unpaired' | 'ambiguous';
export interface AdScriptRow {
    /** Số dòng trong sheet (từ 1). */
    row: number;
    /** Tên mục phase chứa dòng này, ví dụ "Phase 2". */
    phase: string;
    /** Cột Screen đã điền lại cho các ô trống. */
    screen: string;
    adsName: string;
    /** Ghi chú khi cột Ads name bắt đầu bằng "Note:". */
    note?: string;
    /** Resource name; dùng Ads name thay thế khi trống (D-072). */
    resources: string[];
    resourceSource: 'resource' | 'ads_name' | 'none';
    adsType: AdType;
    adsTypeRaw: string;
    adsId: string;
    /** Key bật/tắt ad; dùng Ads name thay thế khi ad in-app không ghi key (D-072). */
    enableKeys: string[];
    enableKeySource: 'sheet' | 'ads_name' | 'none';
    description: string;
    isHF: boolean;
    hfReason?: 'ads_name' | 'resource' | 'both';
    /** Chỉ có ở ad HF. */
    pairStatus?: PairStatus;
    pairRow?: number;
    /** Chỉ có ở ad thường: các dòng HF ghép với nó. */
    pairedWith?: number[];
    special?: SpecialMatch;
}
export interface PhaseSection {
    name: string;
    /** Dòng của tiêu đề phase (hoặc dòng tiêu đề của file cho phase đầu). 0 nếu không có. */
    row: number;
    ads: number;
}
export type WarningCode = 'missing_id' | 'invalid_id' | 'duplicate_id' | 'resource_multi_id' | 'duplicate_key' | 'missing_type' | 'unknown_type' | 'missing_name' | 'missing_enable_key' | 'key_marker_only' | 'unpaired_hf' | 'ambiguous_pair' | 'empty_phase';
export interface ScriptWarning {
    row: number;
    code: WarningCode;
    message: string;
}
export interface AdScript {
    sheet: string;
    headerRow: number;
    phases: PhaseSection[];
    rows: AdScriptRow[];
    warnings: ScriptWarning[];
    /** Dòng được bỏ qua vì là dòng hướng dẫn mẫu ngay dưới tiêu đề. */
    skippedRows: number[];
}
/** Chuẩn hóa một sheet kịch bản thành danh sách ad (D-071: kiểm mọi mục phase trong sheet). */
export declare function readAdScript(sheet: SheetData): AdScript;
