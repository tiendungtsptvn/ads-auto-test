// `cli.js` là MCP client thật (D-082): spawn server, bắt tay, gọi tool. Các test này kiểm đường đó.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect, describeParams } from '../dist/mcp-client.js';
import { makeLog, tmpFile, configBlock, ID, loadStart, loadOk, show } from './fixtures.mjs';
import { scriptSheetRows, xlsxFile } from './xlsx-fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');

function runCli(args, { input, env } = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const logFile = () =>
  tmpFile(
    makeLog([
      ...configBlock('10:00:00.000', { version: '5.5.5', prefs: { fo_a: 'true' } }),
      loadStart('10:00:01.000', 'Native', ID(1)),
      loadOk('10:00:02.000', 'Native', ID(1)),
      show('10:00:03.000', 'NATIVE', ID(1)),
    ]),
  );
const xlsx = () =>
  xlsxFile([{ name: 'S', rows: scriptSheetRows([{ name: 'a', res: 'fo_a', key: 'k', id: ID(1) }]) }]);

const MODES = [[], ['--protocol', 'modern'], ['--direct']];

test('call: cùng một kết quả ở cả ba chế độ (MCP legacy, MCP modern, --direct) cho cả 3 tool', async () => {
  const log = logFile();
  const x = await xlsx();
  const calls = [
    ['parse_logcat', { log_path: log }],
    ['search_logcat', { log_path: log, tag: 'SHOW_AD' }],
    ['read_ad_script', { xlsx_path: x }],
  ];
  for (const [name, args] of calls) {
    const outs = MODES.map((m) => runCli(['call', name, JSON.stringify(args), ...m]));
    for (const o of outs) assert.equal(o.code, 0, `${name}: ${o.err}`);
    assert.deepEqual(JSON.parse(outs[0].out), JSON.parse(outs[1].out), `${name}: legacy khác modern`);
    assert.deepEqual(JSON.parse(outs[0].out), JSON.parse(outs[2].out), `${name}: MCP khác direct`);
  }
});

test('call qua MCP thật sự đi qua server: lỗi schema do server sinh ra, khác với --direct', () => {
  const mcp = runCli(['call', 'parse_logcat', '{}']);
  const direct = runCli(['call', 'parse_logcat', '{}', '--direct']);
  assert.match(mcp.err, /Input validation error/);
  assert.doesNotMatch(direct.err, /Input validation error/);
  assert.match(direct.err, /log_path/);
});

test('lỗi qua MCP (cả hai giao thức): stderr bắt đầu bằng "Lỗi:", stdout rỗng, mã 1, không có "MCP error" thô', () => {
  const cases = [
    ['call', 'parse_logcat', '{}'], // thiếu tham số bắt buộc
    ['call', 'nope', '{}'], // tool không tồn tại
    ['call', 'search_logcat', '{"log_path":"/x.txt","limit":99}'], // ngoài khoảng
    ['call', 'parse_logcat', '{"log_path":"/khong/ton/tai.txt"}'], // lỗi nghiệp vụ
  ];
  for (const proto of ['legacy', 'modern']) {
    for (const c of cases) {
      const r = runCli([...c, '--protocol', proto]);
      assert.equal(r.code, 1, `${proto} ${c.join(' ')}`);
      assert.equal(r.out, '');
      assert.ok(r.err.startsWith('Lỗi:'), `${proto} ${c.join(' ')} -> ${r.err}`);
      assert.doesNotMatch(r.err, /MCP error/);
      assert.ok(!/\bat \S+ \(/.test(r.err), 'không có stack trace');
    }
  }
});

test('--raw: legacy có content, structuredContent; modern có thêm resultType và serverInfo do server thêm vào', () => {
  const log = logFile();
  const args = JSON.stringify({ log_path: log });
  const legacy = JSON.parse(runCli(['call', 'parse_logcat', args, '--raw']).out);
  assert.ok(Array.isArray(legacy.content) && legacy.structuredContent);
  assert.equal(legacy.resultType, undefined);

  const modern = JSON.parse(runCli(['call', 'parse_logcat', args, '--raw', '--protocol', 'modern']).out);
  assert.equal(modern.resultType, 'complete');
  assert.equal(modern._meta['io.modelcontextprotocol/serverInfo'].name, 'ads-test-mcp');
  assert.deepEqual(modern.structuredContent, legacy.structuredContent);
});

test('--summary in phần tóm tắt dạng chữ; mặc định in JSON structuredContent', () => {
  const log = logFile();
  const args = JSON.stringify({ log_path: log });
  const s = runCli(['call', 'parse_logcat', args, '--summary']);
  assert.match(s.out, /1 ad id/);
  assert.throws(() => JSON.parse(s.out));
  assert.equal(JSON.parse(runCli(['call', 'parse_logcat', args]).out).lib_version, '5.5.5');
});

test('tools/list qua MCP: cùng tên và cùng tham số (kể cả tùy chọn) với bảng TOOLS của --direct', () => {
  const mcp = JSON.parse(runCli(['tools/list']).out);
  const direct = JSON.parse(runCli(['tools/list', '--direct']).out);
  assert.deepEqual(mcp.map((t) => t.name), direct.map((t) => t.name));
  for (const t of mcp) {
    const d = direct.find((x) => x.name === t.name);
    assert.deepEqual(Object.keys(t.params).sort(), Object.keys(d.params).sort(), t.name);
    assert.ok(t.description.length > 0);
  }
});

test('discover: DiscoverResult theo spec 2026-07-28, tự dùng giao thức modern; không dùng được với --direct', () => {
  const r = runCli(['discover']);
  assert.equal(r.code, 0);
  const d = JSON.parse(r.out);
  assert.equal(d.resultType, 'complete');
  assert.deepEqual(d.supportedVersions, ['2026-07-28']);
  assert.ok(d.capabilities.tools);
  assert.equal(d._meta['io.modelcontextprotocol/serverInfo'].name, 'ads-test-mcp');
  assert.ok(Number.isInteger(d.ttlMs));

  const direct = runCli(['discover', '--direct']);
  assert.equal(direct.code, 1);
  assert.ok(direct.err.startsWith('Lỗi:'));
});

test('prompts/list và resources/list trả mảng rỗng vì server không có prompts và resources (D-057)', () => {
  for (const cmd of ['prompts/list', 'resources/list']) {
    for (const m of MODES) assert.deepEqual(JSON.parse(runCli([cmd, ...m]).out), [], `${cmd} ${m.join(' ')}`);
  }
});

test('tùy chọn sai: --protocol không hợp lệ, thiếu giá trị, lệnh lạ', () => {
  for (const args of [['tools/list', '--protocol', 'xyz'], ['tools/list', '--protocol'], ['foo']]) {
    const r = runCli(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.ok(r.err.startsWith('Lỗi:'), r.err);
  }
});

test('log của server MCP bị ẩn mặc định, hiện khi đặt ADS_TEST_DEBUG=1', () => {
  const quiet = runCli(['tools/list']);
  assert.doesNotMatch(quiet.err, /đang chạy/);
  const debug = runCli(['tools/list'], { env: { ADS_TEST_DEBUG: '1' } });
  assert.match(debug.err, /đang chạy \(stdio\)/);
});

test('session: một tiến trình phục vụ nhiều dòng, lỗi một dòng không làm dừng cả phiên', () => {
  const log = logFile();
  const lines = [
    '{"command":"tools/list"}',
    JSON.stringify({ command: 'call', name: 'parse_logcat', arguments: { log_path: log } }),
    '{"command":"call","name":"nope"}', // tool không tồn tại: ok:true nhưng isError (giống test-client của grooming)
    'không phải json',
    '{"command":"khac"}',
    '',
    JSON.stringify({ name: 'search_logcat', arguments: { log_path: log, tag: 'SHOW_AD' } }), // command mặc định là call
  ];
  for (const proto of ['legacy', 'modern']) {
    const r = runCli(['session', '--protocol', proto], { input: lines.join('\n') + '\n' });
    assert.equal(r.code, 0, r.err);
    const out = r.out.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(out.length, 6, proto);
    assert.equal(out[0].ok, true);
    assert.deepEqual(out[0].result.map((t) => t.name), ['parse_logcat', 'search_logcat', 'read_ad_script', 'verify_ads']);
    assert.equal(out[1].result.structuredContent.lib_version, '5.5.5');
    assert.equal(out[2].ok, true);
    assert.equal(out[2].result.isError, true);
    assert.equal(out[3].ok, false);
    assert.ok(out[3].error.startsWith('Lỗi:'));
    assert.equal(out[4].ok, false);
    assert.equal(out[5].result.structuredContent.total_matched, 1);
  }
});

test('connect: server không khởi động được thì báo lỗi chung, không lộ đường dẫn, cả hai giao thức', async () => {
  for (const protocol of ['legacy', 'modern']) {
    await assert.rejects(
      connect({ entry: '/duong/dan/bi-mat/khong-co.js', protocol, timeoutMs: 5000 }),
      (e) => e.message.startsWith('Lỗi:') && /Không khởi động được server MCP/.test(e.message) && !e.message.includes('bi-mat'),
      protocol,
    );
  }
});

test('connect: dùng thư viện trực tiếp, close() dọn sạch tiến trình server con (kiểm bằng pid)', async () => {
  for (const protocol of ['legacy', 'modern']) {
    const c = await connect({ protocol });
    assert.equal(c.serverInfo()?.name, 'ads-test-mcp');
    const tools = await c.listTools();
    assert.equal(tools.length, 4);
    assert.ok('log_path' in describeParams(tools[0].inputSchema));
    const res = await c.callTool('search_logcat', { log_path: logFile(), limit: 1 });
    assert.ok(!res.isError);
    const pid = c.pid();
    assert.ok(Number.isInteger(pid) && pid > 0, 'phải có pid của server con');
    await c.close();
    await c.close(); // đóng hai lần không lỗi
    await waitDead(pid);
  }
});

/** Chờ tiến trình kết thúc: kill(pid, 0) ném ESRCH khi tiến trình không còn. */
async function waitDead(pid, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH') return;
      throw e;
    }
    if (Date.now() > end) assert.fail(`server con pid=${pid} vẫn còn sống sau close()`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('describeParams: tên có ? khi tùy chọn, giá trị gồm kiểu và mô tả', () => {
  const p = describeParams({
    properties: { a: { type: 'string', description: 'mô tả a' }, b: { type: 'integer' } },
    required: ['a'],
  });
  assert.deepEqual(p, { a: 'string, mô tả a', 'b?': 'integer' });
});
