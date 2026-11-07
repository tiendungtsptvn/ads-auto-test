import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolError } from './core/errors.js';
const CLIENT_INFO = { name: 'ads-test-cli', version: '0.1.0' };
const MODERN_VERSION = '2026-07-28';
const DEFAULT_TIMEOUT_MS = 60_000;
const STDERR_KEEP = 2000;
export function defaultEntry() {
    return fileURLToPath(new URL('./index.js', import.meta.url));
}
export async function connect(opts = {}) {
    const entry = opts.entry ?? defaultEntry();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return opts.protocol === 'modern'
        ? ModernClient.start(entry, timeoutMs, opts.debug === true)
        : LegacyClient.start(entry, timeoutMs, opts.debug === true);
}
/** Lỗi khởi động: chỉ thông báo chung, không lộ đường dẫn; chi tiết xem với ADS_TEST_DEBUG=1. */
function startFailure() {
    return new ToolError('Không khởi động được server MCP. Kiểm tra đã build (npm run build) và Node từ 20 trở lên; đặt ADS_TEST_DEBUG=1 để xem chi tiết.');
}
// ------------------------------------------------------------ legacy: SDK Client
class LegacyClient {
    client;
    transport;
    timeoutMs;
    protocol = 'legacy';
    constructor(client, transport, timeoutMs) {
        this.client = client;
        this.transport = transport;
        this.timeoutMs = timeoutMs;
    }
    static async start(entry, timeoutMs, debug) {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [entry],
            stderr: debug ? 'inherit' : 'ignore',
        });
        const client = new Client(CLIENT_INFO);
        try {
            await client.connect(transport, { timeout: timeoutMs });
        }
        catch (err) {
            await client.close().catch(() => { });
            if (debug)
                console.error(err);
            throw startFailure();
        }
        return new LegacyClient(client, transport, timeoutMs);
    }
    serverInfo() {
        const v = this.client.getServerVersion();
        return v ? { name: v.name, version: v.version } : undefined;
    }
    pid() {
        return this.transport.pid ?? undefined;
    }
    async listTools() {
        const { tools } = await this.client.listTools(undefined, { timeout: this.timeoutMs });
        return tools;
    }
    async callTool(name, args) {
        return (await this.client.callTool({ name, arguments: args }, undefined, {
            timeout: this.timeoutMs,
        }));
    }
    async listPrompts() {
        if (!this.client.getServerCapabilities()?.prompts)
            return [];
        return (await this.client.listPrompts(undefined, { timeout: this.timeoutMs })).prompts;
    }
    async listResources() {
        if (!this.client.getServerCapabilities()?.resources)
            return [];
        return (await this.client.listResources(undefined, { timeout: this.timeoutMs })).resources;
    }
    async discover() {
        throw new ToolError('discover chỉ có ở chế độ modern. Chạy lại với --protocol modern.');
    }
    async close() {
        await this.client.close().catch(() => { });
    }
}
class ModernClient {
    child;
    timeoutMs;
    protocol = 'modern';
    pending = new Map();
    buf = '';
    nextId = 1;
    info;
    exited = false;
    constructor(child, timeoutMs) {
        this.child = child;
        this.timeoutMs = timeoutMs;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => this.onData(chunk));
        child.on('exit', () => {
            this.exited = true;
            this.failAll(new ToolError('Server MCP đã dừng đột ngột.'));
        });
        child.on('error', () => {
            this.exited = true;
            this.failAll(startFailure());
        });
    }
    static async start(entry, timeoutMs, debug) {
        const child = spawn(process.execPath, [entry], {
            stdio: ['pipe', 'pipe', debug ? 'inherit' : 'ignore'],
        });
        const client = new ModernClient(child, timeoutMs);
        try {
            // Probe theo khuyến nghị của spec: server/discover trước tiên; cũng cho biết server có sống không.
            const d = await client.discover();
            const meta = d._meta;
            const si = meta?.['io.modelcontextprotocol/serverInfo'];
            if (si?.name && si.version)
                client.info = { name: si.name, version: si.version };
        }
        catch (err) {
            await client.close();
            if (debug)
                console.error(err);
            throw startFailure();
        }
        return client;
    }
    serverInfo() {
        return this.info;
    }
    pid() {
        return this.child.pid;
    }
    async discover() {
        return this.request('server/discover', {});
    }
    async listTools() {
        const r = await this.request('tools/list', {});
        return (r.tools ?? []);
    }
    async callTool(name, args) {
        return (await this.request('tools/call', { name, arguments: args }));
    }
    // Server chỉ có tool (D-057); modern không có handshake nên không có khai báo capability để kiểm tra.
    async listPrompts() {
        return [];
    }
    async listResources() {
        return [];
    }
    async close() {
        for (const p of this.pending.values())
            clearTimeout(p.timer);
        this.pending.clear();
        if (!this.exited) {
            this.child.stdin.end();
            this.child.kill();
        }
    }
    request(method, params) {
        if (this.exited)
            return Promise.reject(new ToolError('Server MCP đã dừng.'));
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
            this.child.stdin.write(`${JSON.stringify(msg)}\n`);
        });
    }
    onData(chunk) {
        this.buf += chunk;
        let nl;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, nl);
            this.buf = this.buf.slice(nl + 1);
            if (line.trim() === '')
                continue;
            let m;
            try {
                m = JSON.parse(line);
            }
            catch {
                continue; // stdout chỉ nên có JSON-RPC; dòng lạ bị bỏ qua
            }
            if (typeof m.id !== 'number')
                continue;
            const p = this.pending.get(m.id);
            if (!p)
                continue;
            this.pending.delete(m.id);
            clearTimeout(p.timer);
            if (m.error)
                p.reject(new ToolError(`${m.error.message} (mã ${m.error.code})`));
            else
                p.resolve(m.result ?? {});
        }
    }
    failAll(err) {
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
export function describeParams(schema) {
    const required = new Set(schema.required ?? []);
    const out = {};
    for (const [name, p] of Object.entries(schema.properties ?? {})) {
        const type = Array.isArray(p.type) ? p.type.join('|') : (p.type ?? 'any');
        out[required.has(name) ? name : `${name}?`] = p.description ? `${type}, ${p.description}` : type;
    }
    return out;
}
//# sourceMappingURL=mcp-client.js.map