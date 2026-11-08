// Kiểm tra hai thế hệ MCP trên cùng một tiến trình stdio, bằng JSON-RPC thô.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeLog, tmpFile, configBlock, ID, loadStart, loadOk, show } from './fixtures.mjs';
import { scriptSheetRows, xlsxFile } from './xlsx-fixtures.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

const MODERN = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'tests', version: '0.0.0' },
};
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

/**
 * Gửi các request lần lượt (mỗi request chờ phản hồi của nó), trả về Map id -> phản hồi.
 * Mọi dòng stdout phải là JSON hợp lệ, nếu không test fail (server không được in rác ra stdout).
 */
async function converse(requests) {
  const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'ignore'] });
  const responses = new Map();
  const waiters = new Map();
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim() === '') continue;
      const msg = JSON.parse(line); // ném lỗi nếu không phải JSON
      if (msg.id !== undefined) {
        responses.set(msg.id, msg);
        waiters.get(msg.id)?.(msg);
      }
    }
  });
  try {
    for (const r of requests) {
      const wait = new Promise((resolve, reject) => {
        waiters.set(r.id, resolve);
        setTimeout(() => reject(new Error(`hết thời gian chờ phản hồi id=${r.id}`)), 8000).unref();
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...r })}\n`);
      await wait;
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
  return responses;
}

const logFile = () =>
  tmpFile(
    makeLog([
      ...configBlock('10:00:00.000', { version: '9.9.9', prefs: { fo_a: 'true' } }),
      loadStart('10:00:01.000', 'Native', ID(1)),
      loadOk('10:00:02.000', 'Native', ID(1)),
      show('10:00:03.000', 'NATIVE', ID(1)),
    ]),
  );

test('server/discover: DiscoverResult đủ trường, không cần initialize trước', async () => {
  const res = await converse([{ id: 1, method: 'server/discover', params: { _meta: MODERN } }]);
  const r = res.get(1).result;
  assert.equal(r.resultType, 'complete');
  assert.deepEqual(r.supportedVersions, ['2026-07-28']);
  assert.ok(r.capabilities.tools);
  assert.equal(r.capabilities.tools.listChanged, undefined, 'chưa có subscriptions/listen nên không khai listChanged');
  assert.equal(r._meta[SERVER_INFO_KEY].name, 'ads-test-mcp');
  assert.equal(typeof r.instructions, 'string');
  assert.ok(Number.isInteger(r.ttlMs) && r.ttlMs >= 0);
  assert.ok(['public', 'private'].includes(r.cacheScope));
});

test('tools/list modern: resultType, ttlMs, cacheScope, serverInfo; tool vẫn đủ schema', async () => {
  const res = await converse([{ id: 1, method: 'tools/list', params: { _meta: MODERN } }]);
  const r = res.get(1).result;
  assert.equal(r.resultType, 'complete');
  assert.ok(r.ttlMs >= 0);
  assert.ok(['public', 'private'].includes(r.cacheScope));
  assert.equal(r._meta[SERVER_INFO_KEY].name, 'ads-test-mcp');
  assert.deepEqual(r.tools.map((t) => t.name), ['parse_logcat', 'search_logcat', 'read_ad_script', 'verify_ads', 'map_remote_keys']);
  for (const t of r.tools) assert.ok(t.inputSchema && t.outputSchema);
});

test('tools/call modern: resultType complete, structuredContent nguyên vẹn, không có hint cache', async () => {
  const f = logFile();
  const res = await converse([
    { id: 1, method: 'tools/call', params: { name: 'parse_logcat', arguments: { log_path: f }, _meta: MODERN } },
  ]);
  const r = res.get(1).result;
  assert.equal(r.resultType, 'complete');
  assert.equal(r.structuredContent.lib_version, '9.9.9');
  assert.equal(r.structuredContent.ads.total, 1);
  assert.equal(r._meta[SERVER_INFO_KEY].name, 'ads-test-mcp');
  assert.equal(r.ttlMs, undefined);
  assert.equal(r.cacheScope, undefined);
});

test('tools/call modern: lỗi nghiệp vụ là result isError kèm resultType complete', async () => {
  const res = await converse([
    {
      id: 1,
      method: 'tools/call',
      params: { name: 'parse_logcat', arguments: { log_path: '/khong/ton/tai.txt' }, _meta: MODERN },
    },
  ]);
  const r = res.get(1).result;
  assert.equal(res.get(1).error, undefined);
  assert.equal(r.resultType, 'complete');
  assert.equal(r.isError, true);
  assert.ok(r.content[0].text.startsWith('Lỗi:'));
});

test('version không hỗ trợ: -32022 kèm supported (có 2026-07-28) và requested', async () => {
  const res = await converse([
    {
      id: 1,
      method: 'tools/list',
      params: { _meta: { ...MODERN, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } },
    },
  ]);
  const e = res.get(1).error;
  assert.equal(e.code, -32022);
  assert.ok(e.data.supported.includes('2026-07-28'));
  assert.ok(e.data.supported.includes('2025-11-25'));
  assert.equal(e.data.requested, '1900-01-01');
});

test('thiếu _meta bắt buộc: -32602, kể cả server/discover', async () => {
  const res = await converse([
    { id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
    { id: 2, method: 'server/discover', params: {} },
    {
      id: 3,
      method: 'tools/call',
      params: { name: 'parse_logcat', arguments: {}, _meta: { 'io.modelcontextprotocol/clientCapabilities': {} } },
    },
  ]);
  for (const id of [1, 2, 3]) assert.equal(res.get(id).error.code, -32602, `id=${id}`);
});

test('legacy: initialize rồi tools/list vẫn chạy như cũ, kết quả không thêm trường modern', async () => {
  const res = await converse([
    {
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '0' } },
    },
    { id: 2, method: 'tools/list', params: {} },
  ]);
  assert.equal(res.get(1).result.protocolVersion, '2025-11-25');
  assert.equal(res.get(1).result.resultType, undefined);
  assert.equal(res.get(2).result.resultType, undefined);
  assert.equal(res.get(2).result.ttlMs, undefined);
  assert.equal(res.get(2).result.tools.length, 5);
});

test('hai thế hệ xen kẽ trên cùng một tiến trình, mỗi phản hồi theo đúng thế hệ của request', async () => {
  const f = logFile();
  const res = await converse([
    {
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '0' } },
    },
    { id: 2, method: 'tools/list', params: { _meta: MODERN } }, // modern sau initialize
    { id: 3, method: 'tools/list', params: {} }, // legacy
    { id: 4, method: 'tools/call', params: { name: 'search_logcat', arguments: { log_path: f, tag: 'SHOW_AD' } } },
    {
      id: 5,
      method: 'tools/call',
      params: { name: 'search_logcat', arguments: { log_path: f, tag: 'SHOW_AD' }, _meta: MODERN },
    },
  ]);
  assert.equal(res.get(2).result.resultType, 'complete');
  assert.equal(res.get(3).result.resultType, undefined);
  assert.equal(res.get(4).result.resultType, undefined);
  assert.equal(res.get(5).result.resultType, 'complete');
  assert.equal(res.get(4).result.structuredContent.total_matched, 1);
  assert.equal(res.get(5).result.structuredContent.total_matched, 1);
});

test('request modern chạy được ngay, không cần initialize (stateless)', async () => {
  const f = logFile();
  const res = await converse([
    { id: 'a', method: 'tools/call', params: { name: 'search_logcat', arguments: { log_path: f, limit: 1 }, _meta: MODERN } },
  ]);
  assert.equal(res.get('a').result.resultType, 'complete');
  assert.equal(res.get('a').result.structuredContent.matches.length, 1);
});

test('_meta khai version legacy thì phục vụ theo legacy, không thêm resultType', async () => {
  const res = await converse([
    {
      id: 1,
      method: 'tools/list',
      params: { _meta: { ...MODERN, 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } },
    },
  ]);
  assert.equal(res.get(1).result.resultType, undefined);
  assert.equal(res.get(1).result.tools.length, 5);
});

test('id số và id chuỗi giống nhau không lẫn thế hệ', async () => {
  const res = await converse([
    { id: 1, method: 'tools/list', params: { _meta: MODERN } }, // modern, id số 1
    { id: '1', method: 'tools/list', params: {} }, // legacy, id chuỗi "1"
  ]);
  assert.equal(res.get(1).result.resultType, 'complete');
  assert.equal(res.get('1').result.resultType, undefined);
});

test('read_ad_script (bất đồng bộ) qua request modern: resultType complete, structuredContent nguyên vẹn', async () => {
  const f = await xlsxFile([
    { name: 'S', rows: scriptSheetRows([{ name: 'a', res: 'fo_a', key: 'k', id: ID(1) }]) },
  ]);
  const res = await converse([
    { id: 1, method: 'tools/call', params: { name: 'read_ad_script', arguments: { xlsx_path: f }, _meta: MODERN } },
  ]);
  const r = res.get(1).result;
  assert.equal(r.resultType, 'complete');
  assert.equal(r.structuredContent.counts.ads, 1);
  assert.equal(r.ttlMs, undefined);
});
