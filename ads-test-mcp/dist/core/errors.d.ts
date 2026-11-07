/**
 * Lỗi nghiệp vụ: thông báo tiếng Việt, an toàn để trả cho người gọi (D-029).
 * Không chứa stack trace, hostname hay đường dẫn nội bộ.
 */
export declare class ToolError extends Error {
    constructor(message: string);
}
