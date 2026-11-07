import { type CheckId } from './verify.js';
export declare const FAIL_ITEMS_MAX = 20;
export declare const NOTES_MAX = 5;
export interface FailItem {
    row: number;
    phase: string;
    name: string;
    id: string;
    /** Các kiểm tra FAIL của dòng này. */
    checks: CheckId[];
    /** Thông báo của kiểm tra FAIL đầu tiên. */
    message: string;
}
export interface VerifyAdsResult {
    report_path: string;
    package: string;
    lib_version: string | null;
    log_time: {
        first: string;
        last: string;
    };
    script: {
        sheet: string;
        ads: number;
        phases: number;
    };
    counts: {
        ads: number;
        ok: number;
        fail: number;
        review: number;
        extra_ids: number;
    };
    fail: {
        total: number;
        items: FailItem[];
    };
    review: {
        total: number;
        special_cases: number;
        by_check: Partial<Record<CheckId, number>>;
    };
    /** Các kiểm tra chưa thực hiện được và lưu ý (tối đa 5). */
    notes: string[];
}
export interface VerifyFilesOptions {
    logPath: unknown;
    xlsxPath: unknown;
    sheet?: string;
    acceptancePath?: unknown;
    acceptanceSheet?: string;
    outDir?: unknown;
    /** Thời điểm tạo report (chỉ để test). */
    now?: Date;
}
/** Đọc log, kịch bản và (tùy chọn) file nghiệm thu, đối chiếu, ghi report, trả kết quả gọn. */
export declare function verifyFiles(opts: VerifyFilesOptions): Promise<{
    result: VerifyAdsResult;
    text: string;
}>;
