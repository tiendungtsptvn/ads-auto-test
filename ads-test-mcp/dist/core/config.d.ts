import { type LogEntry } from './logcat.js';
/**
 * Khối CONFIG của tag FOR_TESTER_CONFIG (D-052): giá trị Remote Config app thật sự dùng.
 *  - `Remote FO Prefs`: một entry nhiều dòng, mỗi dòng `key: value`.
 *  - `FO CONFIG CHECKLIST`: nhiều entry liên tiếp, gồm các section `[AD_UNITS - X]` và dòng `key: value`.
 * App có thể khởi động lại trong cùng file log nên mỗi khối được ghi thành một snapshot riêng.
 */
export interface ConfigSnapshot {
    /** Thời điểm entry `Remote FO Prefs` (hoặc checklist nếu không có prefs). */
    time: string;
    /** Số dòng của entry mở đầu snapshot. */
    line: number;
    /** Nhóm `Remote FO Prefs`: key bật/tắt ad và các tham số FO. */
    prefs: Record<string, string>;
    /** Nhóm `FO CONFIG CHECKLIST`: key chứa ad id (resource name) và các giá trị khác. */
    checklist: Record<string, string>;
    /** Tên section của checklist cho từng key, ví dụ `AD_UNITS - SPLASH`. */
    checklistSection: Record<string, string>;
}
export interface ConfigInfo {
    /** Phiên bản lib ghi ở dòng `Version Lib FIRST OPEN` (lần xuất hiện cuối). */
    libVersion?: string;
    /** Các dòng `Version Lib <tên>: <giá trị>`, ví dụ Ads, Adjust. */
    libVersions: Record<string, string>;
    snapshots: ConfigSnapshot[];
}
export declare function extractConfig(entries: LogEntry[]): ConfigInfo;
