import { type Acceptance } from './acceptance.js';
import { type AdScript } from './ad-script.js';
import { type ConsoleConfig, type ConsoleValue } from './remote-config.js';
/**
 * Mapping key remote cho từng ad trong kịch bản (D-098, D-104), tester duyệt trước khi kiểm (D-105).
 * Thứ tự nguồn: phần sửa của tester, key ghi sẵn trong kịch bản, file nghiệm thu, rồi tên gần giống trên danh sách
 * key của console. Quan hệ dữ liệu: một ad có thể có nhiều key (D-090).
 */
export type KeySource = 'tester' | 'script' | 'acceptance' | 'guess' | 'special';
export interface MappedKey {
    /** Tên key; lấy đúng chữ hoa thường của console khi key có trên console. */
    key: string;
    source: KeySource;
    /** Resource (hoặc Ads name) dùng để tìm key, khi key được tra hoặc suy ra. */
    from?: string;
    /** Chi tiết nguồn: mục và ô nghiệm thu, hoặc mức độ khớp khi suy theo tên. */
    detail?: string;
    /** Giá trị trên console; `null` khi key không có trên console. */
    console: ConsoleValue | null;
}
export interface RowKeyMap {
    row: number;
    phase: string;
    adsName: string;
    resources: string[];
    isHF: boolean;
    special: boolean;
    keys: MappedKey[];
    /** Đã tìm được key cho mọi resource của dòng. */
    complete: boolean;
    /** Ghi chú cho tester: không tìm được, nhiều ứng viên, không có trên console, cần test thủ công. */
    notes: string[];
}
export type KeyOverrides = ReadonlyMap<number, readonly string[]>;
/** Đọc `key_overrides`: `{ "<dòng kịch bản>": ["key", ...] }`, giá trị chuỗi thì tách theo dấu phẩy. */
export declare function parseKeyOverrides(raw: unknown): Map<number, string[]> | undefined;
export type GuessResult = {
    status: 'found';
    key: string;
    score: number;
} | {
    status: 'ambiguous';
    candidates: string[];
    score: number;
} | {
    status: 'not_found';
};
/**
 * Suy key bật/tắt từ resource name (hoặc Ads name) bằng cách so tên với các key BOOLEAN trên console: bỏ từ
 * `ad`/`ads`, coi `hf`, `2ID`, `2f` là dấu HF; key phải cùng là HF hoặc cùng là ad thường với dòng kịch bản.
 * Ví dụ `fo_ad_banner_splash` → `fo_banner_splash`, `fo_ad_banner_splash_hf` → `fo_hf_banner_splash`.
 */
export declare function guessKey(name: string, isHF: boolean, consoleKeys: readonly ConsoleValue[]): GuessResult;
export declare function mapRemoteKeys(script: AdScript, cfg: ConsoleConfig, acceptance?: Acceptance, overrides?: KeyOverrides): RowKeyMap[];
/** Key có giá trị không phải true/false trên console (D-099). */
export declare function manualKeys(m: RowKeyMap): string[];
/** Bảng giá trị true/false của các key trên console, để `verify_ads` dùng thay khối Remote FO Prefs của log. */
export declare function consolePrefs(cfg: ConsoleConfig): Record<string, string>;
