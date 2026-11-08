import { type ConsoleConfig, type RcTemplate } from './remote-config.js';
/**
 * Đọc Remote Config bằng `firebase-tools` (hướng A, D-093). Tester đăng nhập bằng `firebase login` trong terminal;
 * token do `firebase-tools` giữ, tool không đọc, không lưu, không truyền token.
 *
 * Chỉ đọc do code bảo đảm (D-004): lệnh con duy nhất được gọi là `remoteconfig:get`, tham số cố định,
 * project id được kiểm định dạng và truyền bằng mảng tham số (không qua shell).
 */
/** Lệnh con duy nhất được phép. Không bao giờ thêm lệnh ghi (D-093). */
export declare const FIREBASE_READ_COMMANDS: readonly ["remoteconfig:get"];
export declare function validateProjectId(raw: unknown): string;
export declare function validateVersion(raw: unknown): string;
export interface FirebaseCommand {
    file: string;
    args: string[];
}
/**
 * Tìm `firebase-tools` trong PATH. Khi tìm được file JavaScript của CLI thì chạy bằng chính Node đang chạy tool,
 * nên trên Windows không phải gọi file `.cmd` qua shell. Bản cài độc lập (file thực thi) thì gọi thẳng.
 */
export declare function locateFirebase(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): FirebaseCommand | undefined;
export interface ExecResult {
    code: number | null;
    stdout: string;
    timedOut: boolean;
}
export type Exec = (cmd: FirebaseCommand, args: string[]) => Promise<ExecResult>;
/** Thông báo lỗi dễ hiểu theo nội dung lỗi của `firebase-tools`; không trả nguyên văn lỗi gốc. */
export declare function firebaseErrorMessage(projectId: string, message: string): string;
export interface ReadOptions {
    exec?: Exec;
    /** Lệnh `firebase` đã biết (để test); mặc định tìm trong PATH. */
    command?: FirebaseCommand;
}
/** Đọc template đang chạy của một project (một lần gọi `firebase`). */
export declare function fetchTemplate(projectId: string, opts?: ReadOptions): Promise<RcTemplate>;
/** Đọc template rồi chọn giá trị theo condition `Tester_<version>` (D-095, D-096). */
export declare function loadConsoleConfig(rawProjectId: unknown, rawVersion: unknown, opts?: ReadOptions): Promise<ConsoleConfig>;
