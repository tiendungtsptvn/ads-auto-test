/**
 * Template Remote Config đọc từ Firebase (M4, D-093) và cách chọn giá trị dùng để test (D-095, D-096).
 * Console là chuẩn, log là đối tượng được test (D-097, D-101). Hàm thuần, không có mạng.
 */
export type RcValueType = 'BOOLEAN' | 'NUMBER' | 'STRING' | 'JSON' | 'UNSPECIFIED';
export interface RcValue {
    value?: string;
    useInAppDefault?: boolean;
}
export interface RcParameter {
    key: string;
    /** Tên nhóm tham số; `null` nếu key nằm ngoài nhóm. */
    group: string | null;
    valueType: RcValueType;
    defaultValue: RcValue | null;
    conditionalValues: Record<string, RcValue>;
}
export interface RcTemplate {
    conditions: Array<{
        name: string;
        expression: string;
    }>;
    parameters: RcParameter[];
    /** Không giữ thông tin người cập nhật (D-056, mvp.md). */
    version: {
        number: string;
        updateTime: string;
    } | null;
}
/** Giá trị một key trên console sau khi chọn theo condition tester hoặc default. */
export interface ConsoleValue {
    key: string;
    group: string | null;
    valueType: RcValueType;
    /** `null` khi key dùng giá trị mặc định trong app (`useInAppDefault`) hoặc không có giá trị. */
    value: string | null;
    origin: 'condition' | 'default';
}
export interface ConsoleConfig {
    projectId: string;
    version: string;
    condition: string;
    templateVersion: {
        number: string;
        updateTime: string;
    } | null;
    /** Theo tên key viết thường. */
    values: Map<string, ConsoleValue>;
}
/** Chuẩn hóa template (nội dung `result` của `firebase remoteconfig:get --json`). */
export declare function normalizeTemplate(raw: unknown): RcTemplate;
/**
 * Tìm condition của tester cho một versionName (D-095). Khớp theo tên sau khi chuẩn hóa (chữ thường, bỏ `_`, `-`,
 * khoảng trắng), nên `Tester_1.0.0` và `tester1.0.0` đều khớp (Q-075). Không dùng biểu thức của condition.
 */
export declare function findTesterCondition(template: RcTemplate, version: string): string;
/**
 * Giá trị dùng để test của mọi key: giá trị riêng của condition tester, không có thì default (D-096).
 * Mọi condition khác bị bỏ qua (D-095).
 */
export declare function resolveConsoleValues(template: RcTemplate, condition: string): Map<string, ConsoleValue>;
/** `true` hoặc `false` cho key BOOLEAN có giá trị; còn lại `undefined` (D-099: không tự kiểm). */
export declare function consoleBool(v: ConsoleValue | undefined): boolean | undefined;
/** Mô tả ngắn giá trị console cho report: `true (tester1.0.0)` hoặc `false (chỉ có default (prod))`. */
export declare function describeConsoleValue(v: ConsoleValue, condition: string): string;
