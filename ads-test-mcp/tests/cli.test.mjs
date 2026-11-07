import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeLog, tmpFile, configBlock, ID, loadStart, loadOk, show } from './fixtures.mjs';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

function run(...args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const logFile = (name = 'log.txt') =>
  tmpFile(
    makeLog([
      ...configBlock('10:00:00.000', { version: '7.7.7', prefs: { fo_a: 'true' } }),
      loadStart('10:00:01.000', 'Native', ID(1)),
      loadOk('10:00:02.000', 'Native', ID(1)),
      show('10:00:03.000', 'NATIVE', ID(1)),
    ]),
    name,
  );

test('tools/list: liệt kê tool và tham số, khớp tên với tool MCP', () => {
  const r = run('tools/list');
  assert.equal(r.code, 0);
  const tools = JSON.parse(r.out);
  assert.deepEqual(tools.map((t) => t.name), ['parse_logcat', 'search_logcat', 'read_ad_script', 'verify_ads']);
  for (const t of tools) {
    assert.ok(t.description);
    assert.ok('log_path' in t.params || 'xlsx_path' in t.params);
  }
  assert.ok('ad_limit?' in tools[0].params);
});

test('call parse_logcat: in JSON giống structuredContent', () => {
  const r = run('call', 'parse_logcat', JSON.stringify({ log_path: logFile() }));
  assert.equal(r.code, 0);
  const res = JSON.parse(r.out);
  assert.equal(res.lib_version, '7.7.7');
  assert.equal(res.ads.total, 1);
  assert.equal(res.ads.rows[0].show, 1);
});

test('call search_logcat: lọc theo tag và giới hạn', () => {
  const r = run('call', 'search_logcat', JSON.stringify({ log_path: logFile(), tag: 'SHOW_AD', limit: 1 }));
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).total_matched, 1);
});

test('call: đường dẫn có dấu cách và tiếng Việt vẫn dùng được trong JSON', () => {
  const f = logFile('log cat mẫu.txt');
  const r = run('call', 'parse_logcat', JSON.stringify({ log_path: f }));
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).entries > 0, true);
});

test('call: lỗi nghiệp vụ in ra stderr bắt đầu bằng "Lỗi:", stdout rỗng, mã 1', () => {
  const r = run('call', 'parse_logcat', JSON.stringify({ log_path: '/khong/ton/tai.txt' }));
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.ok(r.err.startsWith('Lỗi:'));
  assert.ok(!r.err.includes('khong/ton/tai'));
  assert.ok(!/\bat \S+ \(/.test(r.err), 'không có stack trace');
});

test('call: tool không tồn tại, JSON hỏng, không phải object, thiếu tên tool', () => {
  const cases = [
    ['call', 'nope', '{}'],
    ['call', 'parse_logcat', '{bad'],
    ['call', 'parse_logcat', '[1,2]'],
    ['call', 'parse_logcat', '"x"'],
    ['call'],
    ['call', 'parse_logcat', '{}', 'thừa'],
  ];
  for (const args of cases) {
    const r = run(...args);
    assert.equal(r.code, 1, args.join(' '));
    assert.ok(r.err.startsWith('Lỗi:'), `${args.join(' ')} -> ${r.err}`);
  }
});

test('call: tham số sai ngoài khoảng bị từ chối giống phía server MCP', () => {
  const f = logFile();
  const r = run('call', 'search_logcat', JSON.stringify({ log_path: f, limit: 31 }));
  assert.equal(r.code, 1);
  assert.ok(r.err.startsWith('Lỗi:'));
});

test('call: không có tham số thì báo thiếu log_path', () => {
  const r = run('call', 'parse_logcat');
  assert.equal(r.code, 1);
  assert.ok(r.err.includes('log_path'));
});

test('dạng cờ vẫn dùng được: parse --summary và search --tag', () => {
  const f = logFile();
  const a = run('parse', '--log', f, '--summary');
  assert.equal(a.code, 0);
  assert.match(a.out, /1 ad id/);
  const b = run('search', '--log', f, '--tag', 'SHOW_AD');
  assert.equal(JSON.parse(b.out).total_matched, 1);
});

test('lệnh lạ và không có lệnh: lệnh lạ báo lỗi, không có lệnh in cách dùng', () => {
  assert.equal(run('foo').code, 1);
  const h = run();
  assert.equal(h.code, 0);
  assert.match(h.out, /tools\/list/);
  assert.match(h.out, /call <tool_name>/);
});
