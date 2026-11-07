/**
 * MCP client cho `cli.js`, theo mô hình `test-client.mjs` của grooming-mcp (D-082): spawn server qua stdio,
 * bắt tay MCP thật rồi gọi tool. Nhờ vậy đường gọi bằng CLI đi qua đúng server MCP mà các host dùng
 * (kiểm tra schema, outputSchema, lớp dual-era), không đi tắt vào `core`.
 *
 * Hai cách nói chuyện với server:
 *  - legacy: SDK `Client`, handshake `initialize` (giống test-client của grooming-mcp);
 *  - modern: JSON-RPC thô theo spec 2026-07-28 (per-request `_meta`, `server/discover`), không handshake.
 */
export type Protocol = 'legacy' | 'modern';
export interface ToolDescriptor {
    name: string;
    title?: string;
    description?: string;
    inputSchema: {
        type?: string;
        properties?: Record<string, {
            type?: string | string[];
            description?: string;
            enum?: unknown[];
        }>;
        required?: string[];
    };
    outputSchema?: unknown;
    annotations?: Record<string, unknown>;
}
export interface CallResult {
    content?: Array<{
        type: string;
        text?: string;
    }>;
    structuredContent?: unknown;
    isError?: boolean;
    [key: string]: unknown;
}
export interface McpToolsClient {
    readonly protocol: Protocol;
    serverInfo(): {
        name: string;
        version: string;
    } | undefined;
    /** pid của tiến trình server con (dùng để kiểm tra đã dọn sạch sau `close`). */
    pid(): number | undefined;
    listTools(): Promise<ToolDescriptor[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<CallResult>;
    /** Server không khai báo prompts thì trả mảng rỗng. */
    listPrompts(): Promise<unknown[]>;
    /** Server không khai báo resources thì trả mảng rỗng. */
    listResources(): Promise<unknown[]>;
    /** Chỉ có ở chế độ modern; chế độ legacy ném `ToolError`. */
    discover(): Promise<Record<string, unknown>>;
    close(): Promise<void>;
}
export interface ConnectOptions {
    /** Đường dẫn file điểm vào của server MCP. Mặc định `index.js` cạnh file này. */
    entry?: string;
    protocol?: Protocol;
    /** Hiện stderr của server (mặc định chỉ giữ lại để báo lỗi khi không khởi động được). */
    debug?: boolean;
    /** Thời gian chờ mỗi request, mili giây. */
    timeoutMs?: number;
}
export declare function defaultEntry(): string;
export declare function connect(opts?: ConnectOptions): Promise<McpToolsClient>;
/**
 * Rút gọn `inputSchema` thành bảng tham số giống `TOOLS` (tên có `?` nếu tùy chọn, giá trị là
 * "kiểu, mô tả"), để `tools/list` của CLI cùng dạng ở cả hai đường.
 */
export declare function describeParams(schema: ToolDescriptor['inputSchema']): Record<string, string>;
