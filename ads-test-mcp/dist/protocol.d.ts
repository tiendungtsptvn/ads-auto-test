/**
 * Logic thuần của lớp tương thích hai thế hệ MCP (dual-era), không import MCP SDK.
 *
 *  - Modern (2026-07-28): mỗi request mang `_meta` với version, capabilities; server stateless,
 *    result có `resultType`, danh sách có `ttlMs` + `cacheScope`, `server/discover` bắt buộc.
 *  - Legacy (2025-11-25 trở xuống): handshake `initialize`, SDK xử lý như trước.
 *
 * Server chọn thế hệ theo cách client mở đầu (versioning.md, "Backward Compatibility"):
 * request có `_meta` modern thì phục vụ stateless; `initialize` và request không có `_meta` modern
 * đi theo legacy. Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 */
export declare const MODERN_VERSIONS: readonly string[];
export declare const META_VERSION = "io.modelcontextprotocol/protocolVersion";
export declare const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
export declare const META_CLIENT_CAPS = "io.modelcontextprotocol/clientCapabilities";
export declare const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
/** Mã lỗi theo spec 2026-07-28 (basic/index, "Error Codes"). */
export declare const ERR_INVALID_PARAMS = -32602;
export declare const ERR_UNSUPPORTED_VERSION = -32022;
/** Hint cache cho các kết quả cacheable (caching.md). Danh sách tool và discover là tĩnh theo version server. */
export declare const CACHE_TTL_MS = 3600000;
export declare const CACHE_SCOPE = "public";
export type JsonObject = Record<string, unknown>;
export interface ServerIdentity {
    name: string;
    version: string;
}
export interface RpcError {
    code: number;
    message: string;
    data?: unknown;
}
export type Classification = 
/** Không phải request (notification, response) hoặc request legacy: chuyển nguyên cho SDK. */
{
    kind: 'passthrough';
}
/** Request modern hợp lệ, chuyển cho SDK rồi bổ sung trường của spec vào kết quả. */
 | {
    kind: 'modern';
    method: string;
}
/** `server/discover` hợp lệ: trả lời trực tiếp, không qua SDK. */
 | {
    kind: 'discover';
}
/** Request lỗi: trả lời bằng error này, không qua SDK. */
 | {
    kind: 'reject';
    error: RpcError;
};
/** Thông điệp là request JSON-RPC: có `method` và `id`. */
export declare function isRequest(msg: unknown): msg is JsonObject & {
    method: string;
    id: string | number;
};
export declare function isResultResponse(msg: unknown): msg is JsonObject & {
    id: string | number;
    result: JsonObject;
};
/** Khóa ổn định cho request id (số 1 và chuỗi "1" là hai id khác nhau). */
export declare function idKey(id: string | number): string;
export declare function unsupportedVersionError(requested: unknown, legacyVersions: readonly string[]): RpcError;
/**
 * Phân loại một thông điệp đến.
 *
 * Quy tắc:
 *  1. Không phải request: passthrough.
 *  2. Không có `_meta` modern và không phải `server/discover`: legacy, passthrough.
 *  3. Có key modern nhưng thiếu protocolVersion hoặc clientCapabilities: -32602.
 *  4. protocolVersion là version legacy đã biết: legacy, passthrough.
 *  5. protocolVersion modern: phục vụ modern (`server/discover` trả lời trực tiếp).
 *  6. Version khác: -32022 kèm danh sách `supported`.
 */
export declare function classify(msg: unknown, legacyVersions: readonly string[]): Classification;
/** Kết quả của `server/discover` (discover.md). */
export declare function buildDiscoverResult(server: ServerIdentity, capabilities: JsonObject, instructions?: string): JsonObject;
/**
 * Bổ sung trường của spec 2026-07-28 vào kết quả SDK trả cho một request modern:
 * `resultType: "complete"`, `_meta[serverInfo]`, và `ttlMs` + `cacheScope` cho kết quả cacheable.
 * Không sửa nội dung kết quả gốc.
 */
export declare function decorateModernResult(method: string, result: JsonObject, server: ServerIdentity): JsonObject;
