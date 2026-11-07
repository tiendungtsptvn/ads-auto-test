import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
import {
  buildDiscoverResult,
  classify,
  decorateModernResult,
  idKey,
  isRequest,
  isResultResponse,
  type JsonObject,
  type ServerIdentity,
} from './protocol.js';

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
export class DualEraTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  sessionId?: string;

  /** id -> method của các request modern đã chuyển cho SDK và chưa có phản hồi. */
  private readonly pendingModern = new Map<string, string>();

  constructor(
    private readonly inner: Transport,
    private readonly opts: DualEraOptions,
  ) {}

  async start(): Promise<void> {
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (e) => this.onerror?.(e);
    this.inner.onmessage = (msg, extra) => this.handleIncoming(msg, extra);
    await this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const msg = message as unknown;
    if (isRequestOrNotificationLike(msg)) return this.inner.send(message, options);

    const id = (msg as { id?: string | number }).id;
    if (id !== undefined) {
      const key = idKey(id);
      const method = this.pendingModern.get(key);
      if (method !== undefined) {
        this.pendingModern.delete(key);
        if (isResultResponse(msg)) {
          const decorated = {
            ...msg,
            result: decorateModernResult(method, msg.result, this.opts.server),
          } as unknown as JSONRPCMessage;
          return this.inner.send(decorated, options);
        }
      }
    }
    return this.inner.send(message, options);
  }

  async close(): Promise<void> {
    this.pendingModern.clear();
    await this.inner.close();
  }

  private handleIncoming(msg: JSONRPCMessage, extra?: MessageExtraInfo): void {
    const c = classify(msg, this.opts.legacyVersions);
    switch (c.kind) {
      case 'passthrough':
        this.onmessage?.(msg, extra);
        return;
      case 'modern': {
        const id = (msg as { id: string | number }).id;
        this.pendingModern.set(idKey(id), c.method);
        this.onmessage?.(msg, extra);
        return;
      }
      case 'discover': {
        const id = (msg as { id: string | number }).id;
        this.reply({
          jsonrpc: '2.0',
          id,
          result: buildDiscoverResult(this.opts.server, this.opts.capabilities, this.opts.instructions),
        });
        return;
      }
      case 'reject': {
        if (!isRequest(msg)) return;
        this.reply({ jsonrpc: '2.0', id: msg.id, error: c.error });
        return;
      }
    }
  }

  private reply(message: unknown): void {
    this.inner.send(message as JSONRPCMessage).catch((e: unknown) => {
      this.onerror?.(e instanceof Error ? e : new Error(String(e)));
    });
  }
}

/** Thông điệp server chủ động gửi (có `method`): request hoặc notification, không phải phản hồi. */
function isRequestOrNotificationLike(msg: unknown): boolean {
  return typeof msg === 'object' && msg !== null && 'method' in msg;
}
