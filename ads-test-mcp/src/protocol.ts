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

export const MODERN_VERSIONS: readonly string[] = ['2026-07-28'];

export const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
export const META_CLIENT_CAPS = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

/** Mã lỗi theo spec 2026-07-28 (basic/index, "Error Codes"). */
export const ERR_INVALID_PARAMS = -32602;
export const ERR_UNSUPPORTED_VERSION = -32022;

/** Hint cache cho các kết quả cacheable (caching.md). Danh sách tool và discover là tĩnh theo version server. */
export const CACHE_TTL_MS = 3_600_000;
export const CACHE_SCOPE = 'public';

/** Các method có kết quả cacheable mà server này hỗ trợ (caching.md, "Cacheable Results"). */
const CACHEABLE_METHODS = new Set(['server/discover', 'tools/list']);

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
  | { kind: 'passthrough' }
  /** Request modern hợp lệ, chuyển cho SDK rồi bổ sung trường của spec vào kết quả. */
  | { kind: 'modern'; method: string }
  /** `server/discover` hợp lệ: trả lời trực tiếp, không qua SDK. */
  | { kind: 'discover' }
  /** Request lỗi: trả lời bằng error này, không qua SDK. */
  | { kind: 'reject'; error: RpcError };

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Thông điệp là request JSON-RPC: có `method` và `id`. */
export function isRequest(msg: unknown): msg is JsonObject & { method: string; id: string | number } {
  return (
    isObject(msg) &&
    typeof msg.method === 'string' &&
    (typeof msg.id === 'string' || typeof msg.id === 'number')
  );
}

export function isResultResponse(msg: unknown): msg is JsonObject & { id: string | number; result: JsonObject } {
  return (
    isObject(msg) &&
    (typeof msg.id === 'string' || typeof msg.id === 'number') &&
    isObject(msg.result) &&
    !('error' in msg)
  );
}

/** Khóa ổn định cho request id (số 1 và chuỗi "1" là hai id khác nhau). */
export function idKey(id: string | number): string {
  return `${typeof id}:${id}`;
}

export function unsupportedVersionError(requested: unknown, legacyVersions: readonly string[]): RpcError {
  return {
    code: ERR_UNSUPPORTED_VERSION,
    message: 'Unsupported protocol version',
    data: {
      supported: [...MODERN_VERSIONS, ...legacyVersions],
      requested: typeof requested === 'string' ? requested : null,
    },
  };
}

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
export function classify(msg: unknown, legacyVersions: readonly string[]): Classification {
  if (!isRequest(msg)) return { kind: 'passthrough' };

  const params = isObject(msg.params) ? msg.params : undefined;
  const meta = params && isObject(params._meta) ? params._meta : undefined;
  const hasModernKeys =
    meta !== undefined &&
    (META_VERSION in meta || META_CLIENT_CAPS in meta || META_CLIENT_INFO in meta);
  const isDiscover = msg.method === 'server/discover';

  if (!hasModernKeys && !isDiscover) return { kind: 'passthrough' };

  const version = meta?.[META_VERSION];
  const caps = meta?.[META_CLIENT_CAPS];
  if (typeof version !== 'string' || !isObject(caps)) {
    return {
      kind: 'reject',
      error: {
        code: ERR_INVALID_PARAMS,
        message:
          `Invalid params: _meta must include "${META_VERSION}" (string) ` +
          `and "${META_CLIENT_CAPS}" (object)`,
      },
    };
  }

  if (legacyVersions.includes(version)) return { kind: 'passthrough' };
  if (!MODERN_VERSIONS.includes(version)) {
    return { kind: 'reject', error: unsupportedVersionError(version, legacyVersions) };
  }
  return isDiscover ? { kind: 'discover' } : { kind: 'modern', method: msg.method };
}

/** Kết quả của `server/discover` (discover.md). */
export function buildDiscoverResult(
  server: ServerIdentity,
  capabilities: JsonObject,
  instructions?: string,
): JsonObject {
  return {
    resultType: 'complete',
    supportedVersions: [...MODERN_VERSIONS],
    capabilities,
    _meta: { [META_SERVER_INFO]: { name: server.name, version: server.version } },
    ...(instructions ? { instructions } : {}),
    ttlMs: CACHE_TTL_MS,
    cacheScope: CACHE_SCOPE,
  };
}

/**
 * Bổ sung trường của spec 2026-07-28 vào kết quả SDK trả cho một request modern:
 * `resultType: "complete"`, `_meta[serverInfo]`, và `ttlMs` + `cacheScope` cho kết quả cacheable.
 * Không sửa nội dung kết quả gốc.
 */
export function decorateModernResult(
  method: string,
  result: JsonObject,
  server: ServerIdentity,
): JsonObject {
  const existingMeta = isObject(result._meta) ? result._meta : {};
  const out: JsonObject = {
    ...result,
    resultType: 'complete',
    _meta: {
      ...existingMeta,
      [META_SERVER_INFO]: { name: server.name, version: server.version },
    },
  };
  if (CACHEABLE_METHODS.has(method)) {
    out.ttlMs = CACHE_TTL_MS;
    out.cacheScope = CACHE_SCOPE;
  }
  return out;
}
