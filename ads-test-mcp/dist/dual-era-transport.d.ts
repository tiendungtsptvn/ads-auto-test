import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
import { type JsonObject, type ServerIdentity } from './protocol.js';
export interface DualEraOptions {
    server: ServerIdentity;
    /** Version legacy (handshake `initialize`) mà SDK đang hỗ trợ. */
    legacyVersions: readonly string[];
    /** Capabilities báo trong `server/discover`. */
    capabilities: JsonObject;
    instructions?: string;
}
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
export declare class DualEraTransport implements Transport {
    private readonly inner;
    private readonly opts;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
    sessionId?: string;
    /** id -> method của các request modern đã chuyển cho SDK và chưa có phản hồi. */
    private readonly pendingModern;
    constructor(inner: Transport, opts: DualEraOptions);
    start(): Promise<void>;
    send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void>;
    close(): Promise<void>;
    private handleIncoming;
    private reply;
}
