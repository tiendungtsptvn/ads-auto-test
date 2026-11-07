#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from './core/api.js';
import { ToolError } from './core/errors.js';
import {
  connect,
  describeParams,
  type CallResult,
  type McpToolsClient,
  type Protocol,
} from './mcp-client.js';

/**
 * Đường gọi bằng CLI khi host chặn MCP tùy chỉnh (D-080, D-082). Mặc định `cli.js` là một MCP client thật
 * theo mô hình `test-client.mjs` của grooming-mcp: spawn server qua stdio, bắt tay MCP, gọi tool, nên đi
 * qua đúng server mà các host dùng. `--direct` gọi thẳng core, không qua MCP (dự phòng).
 *
 *   node dist/cli.js tools/list
 *   node dist/cli.js call <tool_name> '<json-args>'
 *   node dist/cli.js session                # mỗi dòng stdin là một JSON, mỗi dòng stdout là một kết quả
 *   node dist/cli.js discover               # server/discover theo spec 2026-07-28
 *   node dist/cli.js prompts/list | resources/list
 * Tùy chọn: --protocol legacy|modern (mặc định legacy), --direct, --raw, --summary.
 * Kết quả in JSON ra stdout (structuredContent của tool). Lỗi in ra stderr, bắt đầu bằng "Lỗi:", thoát mã 1.
 * Dạng cờ để dùng tay:
 *   node dist/cli.js parse  --log <path> [--ad-offset N] [--ad-limit N] [--config] [--config-filter S]
 *   node dist/cli.js search --log <path> [--tag T] [--text S] [--ad-id ID] [--limit N] [--cursor C]
 *   node dist/cli.js script --xlsx <path> [--sheet S] [--phase P] [--offset N] [--limit N]
 *   node dist/cli.js verify --log <path> --xlsx <path> [--sheet S] [--acceptance P] [--acceptance-sheet S] [--out-dir D]
 */

const USAGE = `Cách dùng:
  node dist/cli.js tools/list
  node dist/cli.js call <tool_name> '<json-args>'
  node dist/cli.js session
  node dist/cli.js discover
  node dist/cli.js prompts/list | resources/list
  node dist/cli.js parse  --log <đường dẫn> [--ad-offset N] [--ad-limit N] [--config] [--config-filter S]
  node dist/cli.js search --log <đường dẫn> [--tag T] [--text S] [--ad-id ID] [--limit N] [--cursor C]
  node dist/cli.js script --xlsx <đường dẫn> [--sheet S] [--phase P] [--offset N] [--limit N]
  node dist/cli.js verify --log <đường dẫn> --xlsx <đường dẫn> [--sheet S] [--acceptance P] [--acceptance-sheet S] [--out-dir D]
Tùy chọn chung:
  --protocol legacy|modern   cách nói chuyện với server MCP (mặc định legacy: handshake initialize)
  --direct                   gọi thẳng core, không qua server MCP
  --raw                      in nguyên kết quả MCP (content, structuredContent, isError)
  --summary                  chỉ in phần tóm tắt dạng chữ
Đặt ADS_TEST_DEBUG=1 để xem log của server MCP.`;

interface Globals {
  direct: boolean;
  raw: boolean;
  summary: boolean;
  protocol: Protocol;
}

const MAX_JSON_ARGS = 8192;
const EXIT_GRACE_MS = 3000;

// ------------------------------------------------------------ tham số

function extractGlobals(argv: string[]): { globals: Globals; rest: string[] } {
  const globals: Globals = { direct: false, raw: false, summary: false, protocol: 'legacy' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--direct') globals.direct = true;
    else if (a === '--raw') globals.raw = true;
    else if (a === '--summary') globals.summary = true;
    else if (a === '--protocol') {
      const v = argv[++i];
      if (v !== 'legacy' && v !== 'modern') throw new ToolError('--protocol chỉ nhận legacy hoặc modern.');
      globals.protocol = v;
    } else rest.push(a);
  }
  return { globals, rest };
}

const VALUE_FLAGS = new Set([
  'log',
  'ad-offset',
  'ad-limit',
  'config-filter',
  'tag',
  'text',
  'ad-id',
  'limit',
  'cursor',
  'xlsx',
  'sheet',
  'phase',
  'offset',
  'acceptance',
  'acceptance-sheet',
  'out-dir',
]);
const BOOL_FLAGS = new Set(['config']);

function parseFlags(argv: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new ToolError(`Tham số không hợp lệ: ${a}\n${USAGE}`);
    const name = a.slice(2);
    if (BOOL_FLAGS.has(name)) {
      flags.set(name, true);
    } else if (VALUE_FLAGS.has(name)) {
      const v = argv[++i];
      if (v === undefined) throw new ToolError(`Thiếu giá trị cho --${name}.`);
      flags.set(name, v);
    } else {
      throw new ToolError(`Không có tham số --${name}.\n${USAGE}`);
    }
  }
  return flags;
}

function str(f: Map<string, string | true>, k: string): string | undefined {
  const v = f.get(k);
  return typeof v === 'string' ? v : undefined;
}

function num(f: Map<string, string | true>, k: string): number | undefined {
  const v = str(f, k);
  if (v === undefined) return undefined;
  if (!/^\d{1,9}$/.test(v)) throw new ToolError(`--${k} phải là số nguyên không âm.`);
  return Number(v);
}

function parseJsonArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {};
  if (raw.length > MAX_JSON_ARGS) throw new ToolError('Tham số JSON quá dài.');
  let args: unknown;
  try {
    args = JSON.parse(raw);
  } catch {
    throw new ToolError('Tham số phải là JSON hợp lệ, ví dụ \'{"log_path":"/abs/path.txt"}\'.');
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ToolError('Tham số phải là một object JSON.');
  }
  return args as Record<string, unknown>;
}

// ------------------------------------------------------------ backend: MCP hoặc gọi thẳng core

interface ToolSummary {
  name: string;
  description: string;
  params: Record<string, string>;
}

interface Backend {
  tools(): Promise<ToolSummary[]>;
  call(name: string, args: Record<string, unknown>): Promise<CallResult>;
  prompts(): Promise<unknown[]>;
  resources(): Promise<unknown[]>;
  discover(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

function errorResult(message: string): CallResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function mcpBackend(c: McpToolsClient): Backend {
  return {
    async tools() {
      return (await c.listTools()).map((t) => ({
        name: t.name,
        description: t.description ?? '',
        params: describeParams(t.inputSchema),
      }));
    },
    call: (name, args) => c.callTool(name, args),
    prompts: () => c.listPrompts(),
    resources: () => c.listResources(),
    discover: () => c.discover(),
    close: () => c.close(),
  };
}

function directBackend(): Backend {
  return {
    async tools() {
      return TOOLS.map(({ name, description, params }) => ({ name, description, params }));
    },
    async call(name, args) {
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return errorResult(`Lỗi: Không có tool "${name}". Chạy tools/list để xem danh sách.`);
      try {
        const out = await tool.run(args);
        return { content: [{ type: 'text', text: out.text }], structuredContent: out.result };
      } catch (err) {
        if (err instanceof ToolError) return errorResult(err.message);
        throw err;
      }
    },
    async prompts() {
      return [];
    },
    async resources() {
      return [];
    },
    async discover() {
      throw new ToolError('discover cần đi qua server MCP, không dùng được với --direct.');
    },
    async close() {},
  };
}

/**
 * Chuyển lỗi bất kỳ thành thông báo an toàn để in ra. Chỉ lỗi nghiệp vụ và lỗi giao thức MCP
 * (tool không tồn tại, tham số sai schema) được giữ nội dung; lỗi bất ngờ khác chỉ in thông báo chung.
 */
function toToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  if (err instanceof McpError) {
    const cleaned = err.message.replace(/^MCP error -?\d+:\s*/, '').trim();
    return new ToolError(cleaned !== '' ? cleaned.slice(0, 600) : 'server MCP từ chối yêu cầu.');
  }
  return new ToolError('không xử lý được yêu cầu.');
}

function textOf(r: CallResult): string {
  return (r.content ?? [])
    .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : JSON.stringify(p)))
    .join('\n');
}

// ------------------------------------------------------------ in kết quả

/**
 * Thông báo lỗi của một lần gọi tool về dạng "Lỗi: ...": lỗi nghiệp vụ đã có tiền tố; lỗi do SDK sinh ra
 * (thiếu tham số, tool không tồn tại) có dạng "MCP error -32602: ..." nên bỏ phần đầu và thêm tiền tố.
 */
function errorText(r: CallResult): string {
  const cleaned = textOf(r).replace(/^MCP error -?\d+:\s*/, '').trim();
  return new ToolError(cleaned !== '' ? cleaned : 'không xử lý được yêu cầu.').message;
}

/** In kết quả một lần gọi tool. Trả về mã thoát. */
function printCall(r: CallResult, g: Globals): number {
  if (g.raw) {
    console.log(JSON.stringify(r, null, 2));
  } else if (r.isError) {
    console.error(errorText(r));
  } else if (g.summary) {
    console.log(textOf(r));
  } else {
    console.log(JSON.stringify(r.structuredContent ?? { text: textOf(r) }, null, 2));
  }
  return r.isError ? 1 : 0;
}

// ------------------------------------------------------------ chế độ session

/** Mỗi dòng stdin là JSON `{command?, name?, arguments?}`, mỗi dòng stdout là `{ok, result}` hoặc `{ok:false, error}`. */
async function runSession(backend: Backend): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const req = parseJsonArgs(line);
      const command = typeof req.command === 'string' ? req.command : 'call';
      const name = typeof req.name === 'string' ? req.name : '';
      const args =
        req.arguments && typeof req.arguments === 'object' && !Array.isArray(req.arguments)
          ? (req.arguments as Record<string, unknown>)
          : {};
      let result: unknown;
      if (command === 'tools/list') {
        result = await backend.tools();
      } else if (command === 'call') {
        if (!name) throw new ToolError('Thiếu name của tool.');
        result = await backend.call(name, args);
      } else if (command === 'discover') {
        result = await backend.discover();
      } else if (command === 'prompts/list') {
        result = await backend.prompts();
      } else if (command === 'resources/list') {
        result = await backend.resources();
      } else {
        throw new ToolError(`Lệnh không hợp lệ: ${command}.`);
      }
      console.log(JSON.stringify({ ok: true, result }));
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: toToolError(err).message }));
    }
  }
}

// ------------------------------------------------------------ lệnh chính

async function run(): Promise<number> {
  const { globals, rest } = extractGlobals(process.argv.slice(2));
  const [cmd, ...args] = rest;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return 0;
  }

  // Kiểm tra cú pháp trước khi tốn công khởi động server.
  let toolName = '';
  let toolArgs: Record<string, unknown> = {};
  if (cmd === 'call') {
    const [name, rawArgs, ...extra] = args;
    if (!name || extra.length > 0) throw new ToolError(`Cú pháp: call <tool_name> '<json-args>'\n${USAGE}`);
    toolName = name;
    toolArgs = parseJsonArgs(rawArgs);
  } else if (cmd === 'parse' || cmd === 'search' || cmd === 'script' || cmd === 'verify') {
    const flags = parseFlags(args);
    if (cmd === 'parse') {
      toolName = 'parse_logcat';
      toolArgs = {
        log_path: str(flags, 'log'),
        ad_offset: num(flags, 'ad-offset'),
        ad_limit: num(flags, 'ad-limit'),
        include_config: flags.get('config') === true ? true : undefined,
        config_filter: str(flags, 'config-filter'),
      };
    } else if (cmd === 'search') {
      toolName = 'search_logcat';
      toolArgs = {
        log_path: str(flags, 'log'),
        tag: str(flags, 'tag'),
        text: str(flags, 'text'),
        ad_id: str(flags, 'ad-id'),
        limit: num(flags, 'limit'),
        cursor: str(flags, 'cursor'),
      };
    } else if (cmd === 'verify') {
      toolName = 'verify_ads';
      toolArgs = {
        log_path: str(flags, 'log'),
        xlsx_path: str(flags, 'xlsx'),
        sheet: str(flags, 'sheet'),
        acceptance_path: str(flags, 'acceptance'),
        acceptance_sheet: str(flags, 'acceptance-sheet'),
        out_dir: str(flags, 'out-dir'),
      };
    } else {
      toolName = 'read_ad_script';
      toolArgs = {
        xlsx_path: str(flags, 'xlsx'),
        sheet: str(flags, 'sheet'),
        phase: str(flags, 'phase'),
        offset: num(flags, 'offset'),
        limit: num(flags, 'limit'),
      };
    }
    // Bỏ khóa không có giá trị để server không thấy `undefined`
    toolArgs = Object.fromEntries(Object.entries(toolArgs).filter(([, v]) => v !== undefined));
  } else if (!['tools/list', 'session', 'discover', 'prompts/list', 'resources/list'].includes(cmd)) {
    throw new ToolError(`Lệnh không có: ${cmd}\n${USAGE}`);
  }
  if (cmd === 'discover' && globals.direct) {
    throw new ToolError('discover cần đi qua server MCP, không dùng được với --direct.');
  }

  // discover chỉ có ở giao thức modern
  const protocol: Protocol = cmd === 'discover' ? 'modern' : globals.protocol;
  const backend = globals.direct
    ? directBackend()
    : mcpBackend(await connect({ protocol, debug: process.env.ADS_TEST_DEBUG === '1' }));

  try {
    switch (cmd) {
      case 'tools/list':
        console.log(JSON.stringify(await backend.tools(), null, 2));
        return 0;
      case 'discover':
        console.log(JSON.stringify(await backend.discover(), null, 2));
        return 0;
      case 'prompts/list':
        console.log(JSON.stringify(await backend.prompts(), null, 2));
        return 0;
      case 'resources/list':
        console.log(JSON.stringify(await backend.resources(), null, 2));
        return 0;
      case 'session':
        await runSession(backend);
        return 0;
      default:
        return printCall(await backend.call(toolName, toolArgs), globals);
    }
  } finally {
    await backend.close();
  }
}

/** Đặt mã thoát và để stdout xả hết; nếu còn handle treo (tiến trình con) thì ép thoát sau một lúc. */
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
}

run().then(
  (code) => finish(code),
  (err: unknown) => {
    console.error(toToolError(err).message);
    finish(1);
  },
);
