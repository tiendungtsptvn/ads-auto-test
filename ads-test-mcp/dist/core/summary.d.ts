import { type AdAnalysis } from './ad-events.js';
import { type ConfigInfo } from './config.js';
import { type LogEntry, type ParsedLog } from './logcat.js';
export declare const AD_LIMIT_DEFAULT = 15;
export declare const AD_LIMIT_MAX = 100;
export declare const SEARCH_LIMIT_DEFAULT = 10;
export declare const SEARCH_LIMIT_MAX = 30;
export declare const ENTRY_TEXT_MAX = 300;
export declare const CONFIG_VALUES_MAX = 100;
export declare const MAX_WARNINGS = 5;
export interface AdRow {
    id: string;
    type: string;
    load: number;
    ok: number;
    fail: number;
    show: number;
    err?: string;
    first: string;
    last: string;
}
export interface ParseLogcatResult {
    package: string;
    lib_version: string | null;
    lib_versions: Record<string, string>;
    time_range: {
        first: string;
        last: string;
    };
    entries: number;
    total_lines: number;
    unparsed_lines: number;
    tag_counts: Record<string, number>;
    ads: {
        total: number;
        offset: number;
        rows: AdRow[];
        next_offset: number | null;
    };
    remote_config: {
        snapshots: number;
        prefs_keys: number;
        checklist_keys: number;
        /** Tên key trong `Remote FO Prefs` có giá trị khác nhau giữa snapshot đầu và cuối (tối đa 10). */
        changed_between_snapshots: string[];
        /** Chỉ có khi `include_config`: giá trị của snapshot cuối. */
        values?: {
            prefs: Record<string, string>;
            checklist: Record<string, string>;
            truncated: boolean;
        };
    };
    warnings: string[];
}
export interface ParseLogcatOptions {
    adOffset?: number;
    adLimit?: number;
    includeConfig?: boolean;
    /** Chỉ lấy key có chứa chuỗi này (không phân biệt hoa thường) khi `includeConfig`. */
    configFilter?: string;
}
export interface LoadedLog {
    parsed: ParsedLog;
    ads: AdAnalysis;
    config: ConfigInfo;
}
/** Đọc và phân tích file log. Không giữ trạng thái giữa các lần gọi (server stateless). */
export declare function loadLog(logPath: unknown): LoadedLog;
export declare function buildParseResult(log: LoadedLog, opts?: ParseLogcatOptions): ParseLogcatResult;
export interface SearchOptions {
    tag?: string;
    text?: string;
    adId?: string;
    limit?: number;
    cursor?: string;
}
export interface SearchMatch {
    index: number;
    line: number;
    time: string;
    tag: string;
    level: string;
    text: string;
}
export interface SearchLogcatResult {
    matches: SearchMatch[];
    total_matched: number;
    next_cursor: string | null;
}
export declare function searchEntries(entries: LogEntry[], opts: SearchOptions): SearchLogcatResult;
