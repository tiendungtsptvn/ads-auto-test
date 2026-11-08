import { type Acceptance } from './acceptance.js';
import { type AdScript } from './ad-script.js';
import { type KeySource, type RowKeyMap } from './key-map.js';
import { type ReadOptions } from './rc-reader.js';
import { type ConsoleConfig } from './remote-config.js';
/** Tool `map_remote_keys` (M4, D-098, D-105): bảng mapping key của từng ad để tester duyệt trước khi verify. */
export declare const MAP_ROWS_MAX = 80;
export interface ConsoleArgs {
    firebaseProjectId?: unknown;
    version?: unknown;
    keyOverrides?: unknown;
    /** Chỉ để test: cách gọi firebase giả. */
    rcRead?: ReadOptions;
}
/** Đọc console và dựng bảng mapping; dùng chung cho `map_remote_keys` và `verify_ads`. */
export declare function loadKeyMap(script: AdScript, acceptance: Acceptance | undefined, args: ConsoleArgs): Promise<{
    console: ConsoleConfig;
    keyMap: RowKeyMap[];
}>;
export interface MapKeysItem {
    row: number;
    name: string;
    keys: Array<{
        key: string;
        src: KeySource;
        value: string | null;
        origin: 'condition' | 'default' | 'missing';
    }>;
    notes: string[];
}
export interface MapRemoteKeysResult {
    report_path: string;
    firebase_project: string;
    condition: string;
    template_version: {
        number: string;
        update_time: string;
    } | null;
    script: {
        sheet: string;
        ads: number;
    };
    counts: {
        ads: number;
        complete: number;
        incomplete: number;
        manual: number;
        not_on_console: number;
        by_source: Record<KeySource, number>;
    };
    rows: {
        total: number;
        items: MapKeysItem[];
    };
}
export interface MapKeysOptions extends ConsoleArgs {
    xlsxPath: unknown;
    sheet?: string;
    acceptancePath?: unknown;
    acceptanceSheet?: string;
    outDir?: unknown;
    now?: Date;
}
export declare function renderKeyMapReport(keyMap: readonly RowKeyMap[], cfg: ConsoleConfig, meta: {
    generatedAt: Date;
    scriptFile: string;
    sheet: string;
    acceptanceFile?: string;
}): string;
export declare function mapKeysFiles(opts: MapKeysOptions): Promise<{
    result: MapRemoteKeysResult;
    text: string;
}>;
