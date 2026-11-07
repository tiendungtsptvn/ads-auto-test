import { type LogEntry } from './logcat.js';
/** 5 loại ad theo D-067. `Unknown` là giá trị lạ ngoài bảng ánh xạ, báo lại chứ không đoán. */
export type AdType = 'Inter' | 'Resume' | 'Reward' | 'Native' | 'Banner' | 'Unknown';
export type AdEventKind = 'load_start' | 'load_ok' | 'load_fail' | 'show';
export interface AdEvent {
    kind: AdEventKind;
    /** Ad unit id; chuỗi rỗng nếu log in id trống (ví dụ `OnlyId(adUnitId=)`). */
    id: string;
    adType: AdType;
    time: string;
    ms: number;
    entryIndex: number;
    line: number;
    /** Chỉ có ở `load_fail`: nội dung lỗi đã rút gọn. */
    error?: string;
}
export interface AdSummary {
    id: string;
    adType: AdType;
    loadStart: number;
    loadOk: number;
    loadFail: number;
    show: number;
    lastError?: string;
    firstTime: string;
    lastTime: string;
}
export interface AdAnalysis {
    events: AdEvent[];
    ads: AdSummary[];
    /** Nhãn loại ad không có trong bảng ánh xạ. */
    unknownTypeLabels: string[];
}
/**
 * Trích ad event từ các tag LOAD_AD, SHOW_AD, LOAD_FAILURE.
 *
 * Một lần load fail có thể được in nhiều dòng (LOAD_AD "has load error", LOAD_AD
 * "load native ad single", LOAD_FAILURE). Các dòng đó gộp thành một event nếu cùng ID,
 * đến từ nguồn khác nhau và cách nhau không quá FAIL_DEDUP_WINDOW_MS. Hai dòng cùng nguồn
 * luôn là hai lần fail riêng.
 */
export declare function analyzeAds(entries: LogEntry[]): AdAnalysis;
