import { buildDiscoverResult, classify, decorateModernResult, idKey, isRequest, isResultResponse, } from './protocol.js';
/**
 * Bọc một transport (stdio) để server nói được cả hai thế hệ MCP trên cùng một tiến trình.
 *
 * Chiều đến: request modern (có `_meta` per-request) được kiểm tra và, nếu hợp lệ, chuyển cho SDK;
 * `server/discover` và request lỗi được trả lời ngay tại đây. Mọi thứ khác (initialize, request legacy,
 * notification) chuyển nguyên cho SDK.
 * Chiều đi: kết quả của request modern được bổ sung `resultType`, `serverInfo`, `ttlMs`, `cacheScope`.
 *
 * Chỉ giữ bảng "request modern đang chờ trả lời" để gắn đúng kết quả với đúng thế hệ. Bảng này
 * không phải state hội thoại: mỗi request vẫn tự mang đủ ngữ cảnh (spec "Statelessness").
 */
export class DualEraTransport {
    inner;
    opts;
    onclose;
    onerror;
    onmessage;
    sessionId;
    /** id -> method của các request modern đã chuyển cho SDK và chưa có phản hồi. */
    pendingModern = new Map();
    constructor(inner, opts) {
        this.inner = inner;
        this.opts = opts;
    }
    async start() {
        this.inner.onclose = () => this.onclose?.();
        this.inner.onerror = (e) => this.onerror?.(e);
        this.inner.onmessage = (msg, extra) => this.handleIncoming(msg, extra);
        await this.inner.start();
    }
    async send(message, options) {
        const msg = message;
        if (isRequestOrNotificationLike(msg))
            return this.inner.send(message, options);
        const id = msg.id;
        if (id !== undefined) {
            const key = idKey(id);
            const method = this.pendingModern.get(key);
            if (method !== undefined) {
                this.pendingModern.delete(key);
                if (isResultResponse(msg)) {
                    const decorated = {
                        ...msg,
                        result: decorateModernResult(method, msg.result, this.opts.server),
                    };
                    return this.inner.send(decorated, options);
                }
            }
        }
        return this.inner.send(message, options);
    }
    async close() {
        this.pendingModern.clear();
        await this.inner.close();
    }
    handleIncoming(msg, extra) {
        const c = classify(msg, this.opts.legacyVersions);
        switch (c.kind) {
            case 'passthrough':
                this.onmessage?.(msg, extra);
                return;
            case 'modern': {
                const id = msg.id;
                this.pendingModern.set(idKey(id), c.method);
                this.onmessage?.(msg, extra);
                return;
            }
            case 'discover': {
                const id = msg.id;
                this.reply({
                    jsonrpc: '2.0',
                    id,
                    result: buildDiscoverResult(this.opts.server, this.opts.capabilities, this.opts.instructions),
                });
                return;
            }
            case 'reject': {
                if (!isRequest(msg))
                    return;
                this.reply({ jsonrpc: '2.0', id: msg.id, error: c.error });
                return;
            }
        }
    }
    reply(message) {
        this.inner.send(message).catch((e) => {
            this.onerror?.(e instanceof Error ? e : new Error(String(e)));
        });
    }
}
/** Thông điệp server chủ động gửi (có `method`): request hoặc notification, không phải phản hồi. */
function isRequestOrNotificationLike(msg) {
    return typeof msg === 'object' && msg !== null && 'method' in msg;
}
//# sourceMappingURL=dual-era-transport.js.map