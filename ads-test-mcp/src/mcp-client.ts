import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolError } from './core/errors.js';

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
    properties?: Record<string, { type?: string | string[]; description?: string; enum?: unknown[] }>;
    required?: string[];
  };
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface CallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export interface McpToolsClient {
  readonly protocol: Protocol;
  serverInfo(): { name: string; version: string } | undefined;
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

const CLIENT_INFO = { name: 'ads-test-cli', version: '0.1.0' };
const MODERN_VERSION = '2026-07-28';
const DEFAULT_TIMEOUT_MS = 60_000;
const STDERR_KEEP = 2000;

export function defaultEntry(): string {
  return fileURLToPath(new URL('./index.js', import.meta.url));
}

export async function connect(opts: ConnectOptions = {}): Promise<McpToolsClient> {
  const entry = opts.entry ?? defaultEntry();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return opts.protocol === 'modern'
    ? ModernClient.start(entry, timeoutMs, opts.debug === true)
    : LegacyClient.start(entry, timeoutMs, opts.debug === true);
}

/** Lỗi khởi động: chỉ thông báo chung, không lộ đường dẫn; chi tiết xem với ADS_TEST_DEBUG=1. */
function startFailure(): ToolError {
  return new ToolError(
    'Không khởi động được server MCP. Kiểm tra đã build (npm run build) và Node từ 20 trở lên; đặt ADS_TEST_DEBUG=1 để xem chi tiết.',
  );
}

// ------------------------------------------------------------ legacy: SDK Client

class LegacyClient implements McpToolsClient {
  readonly protocol = 'legacy' as const;

  private constructor(
    private readonly client: Client,
    private readonly transport: StdioClientTransport,
    private readonly timeoutMs: number,
  ) {}

  static async start(entry: string, timeoutMs: number, debug: boolean): Promise<LegacyClient> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      stderr: debug ? 'inherit' : 'ignore',
    });
    const client = new Client(CLIENT_INFO);
    try {
      await client.connect(transport, { timeout: timeoutMs });
    } catch (err) {
      await client.close().catch(() => {});
      if (debug) console.error(err);
      throw startFailure();
    }
    return new LegacyClient(client, transport, timeoutMs);
  }

  serverInfo() {
    const v = this.client.getServerVersion();
    return v ? { name: v.name, version: v.version } : undefined;
  }

  pid(): number | undefined {
    return this.transport.pid ?? undefined;
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const { tools } = await this.client.listTools(undefined, { timeout: this.timeoutMs });
    return tools as unknown as ToolDescriptor[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallResult> {
    return (await this.client.callTool({ name, arguments: args }, undefined, {
      timeout: this.timeoutMs,
    })) as CallResult;
  }

  async listPrompts(): Promise<unknown[]> {
    if (!this.client.getServerCapabilities()?.prompts) return [];
    return (await this.client.listPrompts(undefined, { timeout: this.timeoutMs })).prompts;
  }

  async listResources(): Promise<unknown[]> {
    if (!this.client.getServerCapabilities()?.resources) return [];
    return (await this.client.listResources(undefined, { timeout: this.timeoutMs })).resources;
  }

  async discover(): Promise<Record<string, unknown>> {
    throw new ToolError('discover chỉ có ở chế độ modern. Chạy lại với --protocol modern.');
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => {});
  }
}

// ------------------------------------------------------------ modern: JSON-RPC thô (spec 2026-07-28)

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

class ModernClient implements McpToolsClient {
  readonly protocol = 'modern' as const;
  private readonly pending = new Map<number, Pending>();
  private buf = '';
  private nextId = 1;
  private info: { name: string; version: string } | undefined;
  private exited = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly timeoutMs: number,
  ) {
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.onData(chunk));
    child.on('exit', () => {
      this.exited = true;
      this.failAll(new ToolError('Server MCP đã dừng đột ngột.'));
    });
    child.on('error', () => {
      this.exited = true;
      this.failAll(startFailure());
    });
  }

  static async start(entry: string, timeoutMs: number, debug: boolean): Promise<ModernClient> {
    const child = spawn(process.execPath, [entry], {
      stdio: ['pipe', 'pipe', debug ? 'inherit' : 'ignore'],
    });
    const client = new ModernClient(child, timeoutMs);
    try {
      // Probe theo khuyến nghị của spec: server/discover trước tiên; cũng cho biết server có sống không.
      const d = await client.discover();
      const meta = d._meta as Record<string, { name?: string; version?: string }> | undefined;
      const si = meta?.['io.modelcontextprotocol/serverInfo'];
      if (si?.name && si.version) client.info = { name: si.name, version: si.version };
    } catch (err) {
      await client.close();
      if (debug) console.error(err);
      throw startFailure();
    }
    return client;
  }

  serverInfo() {
    return this.info;
  }

  pid(): number | undefined {
    return this.child.pid;
  }

  async discover(): Promise<Record<string, unknown>> {
    return this.request('server/discover', {});
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const r = await this.request('tools/list', {});
    return (r.tools ?? []) as ToolDescriptor[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallResult> {
    return (await this.request('tools/call', { name, arguments: args })) as CallResult;
  }

  // Server chỉ có tool (D-057); modern không có handshake nên không có khai báo capability để kiểm tra.
  async listPrompts(): Promise<unknown[]> {
    return [];
  }

  async listResources(): Promise<unknown[]> {
    return [];
  }

  async close(): Promise<void> {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    if (!this.exited) {
      this.child.stdin!.end();
      this.child.kill();
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.exited) return Promise.reject(new ToolError('Server MCP đã dừng.'));
    const id = this.nextId++;
    const msg = {
      jsonrpc: '2.0',
      id,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
          'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolError(`Quá thời gian chờ server MCP (${Math.round(this.timeoutMs / 1000)} giây).`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin!.write(`${JSON.stringify(msg)}\n`);
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.trim() === '') continue;
      let m: { id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } };
      try {
        m = JSON.parse(line);
      } catch {
        continue; // stdout chỉ nên có JSON-RPC; dòng lạ bị bỏ qua
      }
      if (typeof m.id !== 'number') continue;
      const p = this.pending.get(m.id);
      if (!p) continue;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new ToolError(`${m.error.message} (mã ${m.error.code})`));
      else p.resolve(m.result ?? {});
    }
  }

  private failAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}

// ------------------------------------------------------------ tiện ích dùng chung

/**
 * Rút gọn `inputSchema` thành bảng tham số giống `TOOLS` (tên có `?` nếu tùy chọn, giá trị là
 * "kiểu, mô tả"), để `tools/list` của CLI cùng dạng ở cả hai đường.
 */
export function describeParams(schema: ToolDescriptor['inputSchema']): Record<string, string> {
  const required = new Set(schema.required ?? []);
  const out: Record<string, string> = {};
  for (const [name, p] of Object.entries(schema.properties ?? {})) {
    const type = Array.isArray(p.type) ? p.type.join('|') : (p.type ?? 'any');
    out[required.has(name) ? name : `${name}?`] = p.description ? `${type}, ${p.description}` : type;
  }
  return out;
}
