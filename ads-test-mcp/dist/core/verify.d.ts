import { type AdEvent } from './ad-events.js';
import { type AdScript, type AdScriptRow } from './ad-script.js';
import { type Acceptance, type AcceptanceExcerpt, type KeyLookup } from './acceptance.js';
import { type LoadedLog } from './summary.js';
/**
 * Đối chiếu log với kịch bản (M3). Rule: D-063 đến D-077, bảng "Các kiểm tra" trong mvp.md.
 * Tool chỉ đưa bằng chứng; kết luận đạt hay không đạt do tester quyết định.
 * Tình huống rule chưa nói tới thì báo CẦN XEM (REVIEW), không đoán.
 */
export type Status = 'OK' | 'FAIL' | 'REVIEW';
/** `NA` là kiểm tra không thực hiện được (thiếu dữ liệu), không tính vào OK, FAIL, CẦN XEM. */
export type CheckStatus = Status | 'NA';
export type CheckId = 'id' | 'present' | 'type' | 'hf_order' | 'fail_show' | 'load_once' | 'key_false';
export interface Check {
    check: CheckId;
    status: CheckStatus;
    message: string;
    /** Các dòng bằng chứng trong log (thời gian, dòng log). */
    evidence: string[];
}
export interface KeyValue {
    key: string;
    value: string | null;
    source: 'prefs' | 'checklist' | null;
}
export interface SpecialDetail {
    name: string;
    matchedBy: string;
    acceptanceSection: string | null;
    acceptance: {
        status: 'no_file' | 'no_section_name' | 'not_found' | 'found';
        note: string;
        excerpts: AcceptanceExcerpt[];
    };
    keyValues: KeyValue[];
    idComparisons: string[];
    /** Timeline load, fail, show của ID của dòng này. */
    timeline: string[];
    /** Kết quả các kiểm tra chung, chỉ để tham khảo vì kết quả của case đặc biệt luôn là CẦN XEM. */
    generalChecks: Check[];
}
export interface RowVerdict {
    row: AdScriptRow;
    status: Status;
    checks: Check[];
    special?: SpecialDetail;
}
export interface PairTimeline {
    hfRow: number;
    normalRow: number;
    status: CheckStatus;
    note: string;
    lines: string[];
}
export interface ExtraId {
    id: string;
    adType: string;
    loadStart: number;
    loadOk: number;
    loadFail: number;
    show: number;
    firstTime: string;
    lastTime: string;
}
/** Kết quả tra key remote trong file nghiệm thu cho dòng kịch bản không ghi key (D-083). */
export interface KeyLookupNote {
    row: number;
    resource: string;
    lookup: KeyLookup;
}
/** Dòng load ok hoặc fail lẻ, không có dòng "starting load" tương ứng (D-086). */
export interface LogWarning {
    id: string;
    kind: 'load_ok' | 'load_fail';
    time: string;
    line: number;
    /** Các dòng kịch bản dùng ID này (nhiều ad có thể dùng chung một ID, D-088). */
    rows: Array<{
        row: number;
        phase: string;
        adsName: string;
    }>;
}
export interface VerifyResult {
    rows: RowVerdict[];
    extras: ExtraId[];
    pairs: PairTimeline[];
    keyLookups: KeyLookupNote[];
    logWarnings: LogWarning[];
    notes: string[];
}
export interface VerifyInput {
    script: AdScript;
    log: LoadedLog;
    /** Có file nghiệm thu hay không; `acceptance` chỉ có khi đã đọc được. */
    acceptance?: Acceptance;
}
/**
 * Dòng load ok hoặc fail lẻ: không có dòng "starting load" nào đang chờ kết quả (D-086). Đếm số lần bắt đầu
 * đang chờ, vì log có thể in hai lần bắt đầu rồi hai kết quả.
 */
export declare function loneResults(events: readonly AdEvent[]): AdEvent[];
/** Rule (d): load fail thì không được show khi chưa có lần load thành công mới. */
export declare function failThenShow(events: readonly AdEvent[]): string[];
/**
 * Rule (e): không có hai lần bắt đầu load liên tiếp mà không có show hoặc fail ở giữa. Ca đã load ok rồi load
 * lại mà chưa show vẫn là FAIL (D-087), kèm ghi chú vì có thể do preload hoặc reload.
 */
export declare function loadMoreThanOnce(events: readonly AdEvent[]): string[];
export declare const HF_END_HINT = "c\u00F3 th\u1EC3 b\u00E1o nh\u1EA7m n\u1EBFu log d\u1EEBng tr\u01B0\u1EDBc khi ad th\u01B0\u1EDDng \u0111\u01B0\u1EE3c load, D-087";
/**
 * Rule HF trước (D-063 a, b, c) cho một cặp mà cả hai key đều bật: trả về các vi phạm. Một lần request chỉ
 * tính từ dòng "starting load"; dòng ok hoặc fail lẻ bị bỏ qua (D-086).
 */
export declare function highFloorViolations(hf: readonly AdEvent[], normal: readonly AdEvent[]): string[];
export declare function verifyAds(input: VerifyInput): VerifyResult;
