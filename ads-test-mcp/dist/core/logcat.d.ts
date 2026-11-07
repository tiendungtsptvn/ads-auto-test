/**
 * Một entry logcat xuất từ Android Studio:
 *   2026-10-24 13:38:49.501  9683-9683  FOR_TESTER_CONFIG  com.example.app  I  message
 * Dòng tiếp theo thụt lề (không có timestamp) thuộc về entry trước đó.
 */
export interface LogEntry {
    /** Thứ tự entry trong file, bắt đầu từ 0. */
    index: number;
    /** Số dòng (từ 1) của dòng đầu entry. */
    line: number;
    /** "YYYY-MM-DD HH:MM:SS.mmm", giữ nguyên như trong log. */
    time: string;
    pid: number;
    tid: number;
    tag: string;
    pkg: string;
    level: string;
    /** Dòng đầu của message, đã bỏ khoảng trắng đầu và cuối. */
    message: string;
    /** Các dòng tiếp theo của entry, đã bỏ thụt lề. */
    extra: string[];
}
export interface ParsedLog {
    entries: LogEntry[];
    totalLines: number;
    /** Số dòng không thuộc entry nào (không có timestamp và cũng không thụt lề). */
    unparsedLines: number;
}
export declare const TESTER_TAG_PREFIX = "FOR_TESTER_";
export declare function splitLines(text: string): string[];
/** Text của một entry (dòng đầu cộng các dòng tiếp theo). */
export declare function entryText(e: LogEntry): string;
/** Chuyển "YYYY-MM-DD HH:MM:SS.mmm" thành mili giây, coi như giờ UTC để so sánh tương đối. */
export declare function timeToMs(time: string): number;
export declare function parseLogcat(text: string): ParsedLog;
export interface SearchFilter {
    /** Khớp tag, có thể bỏ tiền tố FOR_TESTER_ (ví dụ "LOAD_AD"). Không phân biệt hoa thường. */
    tag?: string;
    /** Chuỗi con trong text của entry, không phân biệt hoa thường. */
    text?: string;
    /** Ad unit id (hoặc đoạn của nó) xuất hiện trong text của entry. */
    adId?: string;
}
export declare function matchesFilter(e: LogEntry, f: SearchFilter): boolean;
