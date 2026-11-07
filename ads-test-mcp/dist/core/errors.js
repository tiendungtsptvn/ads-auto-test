/**
 * Lỗi nghiệp vụ: thông báo tiếng Việt, an toàn để trả cho người gọi (D-029).
 * Không chứa stack trace, hostname hay đường dẫn nội bộ.
 */
export class ToolError extends Error {
    constructor(message) {
        super(message.startsWith('Lỗi:') ? message : `Lỗi: ${message}`);
        this.name = 'ToolError';
    }
}
//# sourceMappingURL=errors.js.map