import { type AdScript, type PairStatus, type WarningCode } from './ad-script.js';
import { type SheetInfo } from './xlsx.js';
export declare const SCRIPT_LIMIT_DEFAULT = 10;
export declare const SCRIPT_LIMIT_MAX = 50;
export declare const MAX_WARNING_ITEMS = 8;
/** Dòng ad dạng gọn để trả cho agent (nội dung ô là dữ liệu không đáng tin cậy, đã cắt độ dài). */
export interface ScriptAdRow {
    row: number;
    phase: string;
    screen: string;
    name: string;
    res: string[];
    keys: string[];
    type: string;
    id: string;
    hf?: true;
    pair_status?: PairStatus;
    pair_row?: number;
    paired_with?: number[];
    special?: string;
    /** Có mặt khi resource name lấy thay từ Ads name (D-072). */
    src?: 'ads_name';
    note?: string;
}
export interface ReadAdScriptResult {
    sheet: string;
    sheets: Array<{
        name: string;
        state: string;
    }>;
    header_row: number;
    phases: Array<{
        name: string;
        row: number;
        ads: number;
    }>;
    counts: {
        ads: number;
        hf: number;
        paired: number;
        unpaired: number;
        ambiguous: number;
        special: number;
        name_as_resource: number;
    };
    ads: {
        /** Số ad sau khi lọc theo `phase` (nếu có). */
        total: number;
        filter_phase: string | null;
        offset: number;
        rows: ScriptAdRow[];
        next_offset: number | null;
    };
    warnings: {
        total: number;
        items: Array<{
            row: number;
            code: WarningCode;
            message: string;
        }>;
    };
}
export interface ScriptOptions {
    phase?: string;
    offset?: number;
    limit?: number;
}
/**
 * Chọn sheet (D-071): file chỉ có một sheet thì bỏ qua tham số; nhiều sheet mà thiếu hoặc sai tên
 * thì báo lỗi kèm danh sách sheet.
 */
export declare function pickSheet(sheets: readonly SheetInfo[], requested: string | undefined): string;
export declare function loadAdScript(xlsxPath: unknown, sheet: string | undefined): Promise<{
    script: AdScript;
    sheets: SheetInfo[];
}>;
export declare function buildScriptResult(script: AdScript, sheets: readonly SheetInfo[], opts?: ScriptOptions): ReadAdScriptResult;
