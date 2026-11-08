import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runVerifyAds } from '../dist/core/api.js';
import { ToolError } from '../dist/core/errors.js';
import { makeLog, tmpFile, ID, loadStart } from './fixtures.mjs';
import { scriptSheetRows, xlsxFile } from './xlsx-fixtures.mjs';
import { cfg, integrationFiles, tmpDir } from './verify-fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const entry = path.join(root, 'dist', 'index.js');

const reportsIn = (dir) => fs.readdirSync(dir).filter((f) => /^ads-report-.*\.md$/.test(f));

function runCli(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// ------------------------------------------------------------ qua API

test('verify_ads: đếm OK, FAIL, CẦN XEM, ad thừa; FAIL có vị trí và kiểm tra gây lỗi', async () => {
  const f = await integrationFiles();
  const { result: r, text } = await runVerifyAds({ log_path: f.logPath, xlsx_path: f.xlsxPath });
  assert.deepEqual(r.counts, { ads: 4, ok: 1, fail: 2, review: 1, extra_ids: 1 });
  assert.equal(r.fail.total, 2);
  assert.deepEqual(r.fail.items.map((x) => [x.row, x.name, x.checks]), [
    [6, 'ad_gone', ['present']],
    [7, 'reward_ad', ['load_once']],
  ]);
  assert.equal(r.fail.items[0].id, ID(2));
  assert.equal(r.fail.items[0].phase, 'Phase 1');
  assert.match(r.fail.items[1].message, /lần vi phạm/);
  assert.deepEqual(r.review, { total: 1, special_cases: 1, by_check: {} });
  assert.equal(r.package, 'com.example.fakeapp');
  assert.equal(r.script.ads, 4);
  assert.equal(r.script.sheet, 'Phase 8');
  assert.ok(text.split('\n').length <= 4);
  assert.match(text, /lấy từ log \(chưa đối chiếu console\)/);
  assert.deepEqual(r.key_source, { from: 'log' });
  assert.match(text, /OK 1, FAIL 2, CẦN XEM 1/);
  assert.match(text, /kết luận do tester quyết định/);
});

test('verify_ads: ghi report vào thư mục chứa file log theo mặc định, tên ads-report-<thời gian>.md, nội dung khớp kết quả', async () => {
  const f = await integrationFiles();
  const { result: r } = await runVerifyAds({ log_path: f.logPath, xlsx_path: f.xlsxPath });
  assert.equal(path.dirname(r.report_path), f.dir);
  assert.match(path.basename(r.report_path), /^ads-report-\d{8}-\d{6}\.md$/);
  const body = fs.readFileSync(r.report_path, 'utf8');
  assert.match(body, /\nok: 1\nfail: 2\nreview: 1\nextra_ids: 1\n/);
  assert.match(body, /### Dòng 6: ad_gone/);
  assert.match(body, /### Dòng 7: reward_ad/);
  assert.match(body, /### Dòng 8: mix_ad_2ID \(MIX\)/);
  assert.ok(!body.includes(f.dir), 'report không ghi đường dẫn thư mục của tester');
});

test('verify_ads: out_dir chọn thư mục ghi; chạy lại không ghi đè report cũ', async () => {
  const f = await integrationFiles();
  const out = tmpDir();
  const a = (await runVerifyAds({ log_path: f.logPath, xlsx_path: f.xlsxPath, out_dir: out })).result;
  const b = (await runVerifyAds({ log_path: f.logPath, xlsx_path: f.xlsxPath, out_dir: out })).result;
  assert.equal(path.dirname(a.report_path), out);
  assert.notEqual(a.report_path, b.report_path);
  assert.equal(reportsIn(out).length, 2);
  assert.equal(reportsIn(f.dir).length, 0, 'không ghi vào thư mục log khi đã có out_dir');
  assert.equal(fs.readFileSync(a.report_path, 'utf8').includes('ad_gone'), true);
});

test('verify_ads: không sửa file log và file kịch bản', async () => {
  const f = await integrationFiles();
  const before = [fs.readFileSync(f.logPath), fs.readFileSync(f.xlsxPath)];
  await runVerifyAds({ log_path: f.logPath, xlsx_path: f.xlsxPath });
  assert.ok(before[0].equals(fs.readFileSync(f.logPath)));
  assert.ok(before[1].equals(fs.readFileSync(f.xlsxPath)));
});

test('verify_ads: có file nghiệm thu thì report có nguyên văn mục tương ứng; không có thì có ghi chú', async () => {
  const f = await integrationFiles({ withAcceptance: true });
  const withAcc = (await runVerifyAds({ log_path: f.logPath, xlsx_path: f.xlsxPath, acceptance_path: f.acceptancePath })).result;
  const body = fs.readFileSync(withAcc.report_path, 'utf8');
  assert.match(body, /acceptance_file: "nghiem-thu\.xlsx"/);
  assert.match(body, /mục "Ad native splash" trong sheet "Nghiệm thu"/);
  assert.match(body, /Key remote \(D4\): fo_logic_ad_launcher ⏎ logic_na_fu_alt/);
  assert.match(body, /Tiền điều kiện \(E5\): 1\. fo_inter_splash = TRUE/, 'dòng tiếp theo của cùng mục cũng được trích');
  assert.ok(!body.includes('example.com'), 'không lấy cột link ảnh');
  assert.ok(!withAcc.notes.some((n) => /Chưa có file nghiệm thu/.test(n)));
  assert.equal(withAcc.counts.review, 1, 'có file nghiệm thu vẫn không đổi kết luận của case đặc biệt');

  const without = (await runVerifyAds({ log_path: f.logPath, xlsx_path: f.xlsxPath })).result;
  assert.ok(without.notes.some((n) => /Chưa có file nghiệm thu/.test(n)));
});

test('verify_ads: danh sách FAIL tối đa 20 dòng, kèm tổng số; kết quả gọn', async () => {
  const ads = Array.from({ length: 30 }, (_, i) => ({ name: `ad_${i + 1}`, res: `fo_${i + 1}`, key: 'k', id: ID(i + 1) }));
  const dir = tmpDir();
  const logPath = path.join(dir, 'log.txt');
  fs.writeFileSync(logPath, makeLog(cfg({ S: {} }, { k: 'true' })));
  const xlsxPath = await xlsxFile([{ name: 'S', rows: scriptSheetRows(ads) }]);
  const { result: r } = await runVerifyAds({ log_path: logPath, xlsx_path: xlsxPath });
  assert.equal(r.fail.total, 30);
  assert.equal(r.fail.items.length, 20);
  assert.deepEqual(r.fail.items.map((x) => x.row).slice(0, 3), [5, 6, 7]);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 6 * 1024, `${Buffer.byteLength(JSON.stringify(r))} byte`);
  assert.equal(r.counts.review, 0);
});

test('verify_ads: nhiều sheet mà thiếu sheet thì lỗi kèm danh sách; acceptance_sheet cần acceptance_path', async () => {
  const f = await integrationFiles();
  const two = await xlsxFile([
    { name: 'A', rows: scriptSheetRows([{ name: 'a', res: 'fo_a', key: 'k', id: ID(1) }]) },
    { name: 'B', rows: scriptSheetRows([{ name: 'b', res: 'fo_b', key: 'k', id: ID(2) }]) },
  ]);
  await assert.rejects(runVerifyAds({ log_path: f.logPath, xlsx_path: two }), (e) => e instanceof ToolError && /"A"/.test(e.message) && /"B"/.test(e.message));
  const ok = await runVerifyAds({ log_path: f.logPath, xlsx_path: two, sheet: 'B' });
  assert.equal(ok.result.script.sheet, 'B');
  await assert.rejects(runVerifyAds({ log_path: f.logPath, xlsx_path: f.xlsxPath, acceptance_sheet: 'X' }), /acceptance_path/);
});

test('verify_ads: tham số và đường dẫn sai bị từ chối; lỗi không lộ đường dẫn và không ghi report', async () => {
  const f = await integrationFiles();
  const good = { log_path: f.logPath, xlsx_path: f.xlsxPath };
  const cases = [
    {},
    { ...good, log_path: 'tương-đối.txt' },
    { ...good, xlsx_path: 'tương-đối.xlsx' },
    { ...good, out_dir: 'tương-đối' },
    { ...good, out_dir: path.join(f.dir, 'khong-co') },
    { ...good, sheet: 5 },
    { ...good, out_dir: '/bi-mat/khong/ton/tai' },
    { ...good, xlsx_path: tmpFile('không phải excel', 'bi-mat-rieng.xlsx') },
    { ...good, acceptance_path: tmpFile('không phải excel', 'nt-rieng.xlsx') },
    { log_path: tmpFile('không phải logcat\n'.repeat(40)), xlsx_path: f.xlsxPath },
  ];
  for (const c of cases) {
    await assert.rejects(
      runVerifyAds(c),
      (e) => e instanceof ToolError && e.message.startsWith('Lỗi:') && !/bi-mat|nt-rieng|khong\/ton/.test(e.message),
      JSON.stringify(c),
    );
  }
  assert.equal(reportsIn(f.dir).length, 0, 'lỗi thì không để lại report');
});

test('verify_ads: log không khớp các ad trong kịch bản vẫn ra report, không sập', async () => {
  const dir = tmpDir();
  const logPath = path.join(dir, 'log.txt');
  fs.writeFileSync(logPath, makeLog([loadStart('10:00:01.000', 'Native', ID(1))]));
  const xlsxPath = await xlsxFile([{ name: 'S', rows: scriptSheetRows([{ name: 'a', res: 'fo_a', key: 'k', id: ID(9) }]) }]);
  const { result: r } = await runVerifyAds({ log_path: logPath, xlsx_path: xlsxPath });
  assert.equal(r.counts.fail, 1);
  assert.equal(r.counts.extra_ids, 1);
  assert.ok(r.notes.some((n) => /không có khối CONFIG/.test(n)));
});

// ------------------------------------------------------------ qua cli.js (MCP client thật)

test('cli: verify (dạng cờ) và call verify_ads cho cùng kết quả ở legacy, modern và --direct (trừ đường dẫn report)', async () => {
  const f = await integrationFiles();
  const args = { log_path: f.logPath, xlsx_path: f.xlsxPath, out_dir: tmpDir() };
  const strip = (j) => ({ ...j, report_path: undefined });

  const outs = [[], ['--protocol', 'modern'], ['--direct']].map((m) => runCli(['call', 'verify_ads', JSON.stringify(args), ...m]));
  for (const o of outs) assert.equal(o.code, 0, o.err);
  const [a, b, c] = outs.map((o) => JSON.parse(o.out));
  assert.deepEqual(strip(a), strip(b));
  assert.deepEqual(strip(a), strip(c));
  assert.ok(fs.existsSync(a.report_path) && fs.existsSync(b.report_path) && fs.existsSync(c.report_path));

  const flags = runCli(['verify', '--log', f.logPath, '--xlsx', f.xlsxPath, '--out-dir', tmpDir()]);
  assert.equal(flags.code, 0, flags.err);
  assert.deepEqual(strip(JSON.parse(flags.out)), strip(a));
});

test('cli: verify có --acceptance; lỗi in ra stderr dạng "Lỗi:" với mã 1', async () => {
  const f = await integrationFiles({ withAcceptance: true });
  const ok = runCli(['verify', '--log', f.logPath, '--xlsx', f.xlsxPath, '--acceptance', f.acceptancePath, '--out-dir', tmpDir()]);
  assert.equal(ok.code, 0, ok.err);
  assert.ok(fs.readFileSync(JSON.parse(ok.out).report_path, 'utf8').includes('Ad native splash'));

  for (const args of [
    ['verify', '--log', f.logPath],
    ['verify', '--log', f.logPath, '--xlsx', f.xlsxPath, '--out-dir', 'tương-đối'],
    ['call', 'verify_ads', '{"log_path":"/khong/co.txt","xlsx_path":"/khong/co.xlsx"}'],
  ]) {
    const r = runCli(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.equal(r.out, '');
    assert.ok(r.err.startsWith('Lỗi:'), r.err);
  }
  assert.equal(reportsIn(f.dir).length, 0);
});

test('cli: --summary in tóm tắt kèm đường dẫn report', async () => {
  const f = await integrationFiles();
  const r = runCli(['verify', '--log', f.logPath, '--xlsx', f.xlsxPath, '--out-dir', tmpDir(), '--summary']);
  assert.match(r.out, /OK 1, FAIL 2, CẦN XEM 1/);
  assert.match(r.out, /Report: .*ads-report-.*\.md/);
});

// ------------------------------------------------------------ qua MCP

test('mcp: verify_ads có trong tools/list với annotation phù hợp việc ghi file mới, gọi được và khớp outputSchema', async () => {
  const f = await integrationFiles();
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe' });
  const client = new Client({ name: 'tests', version: '0.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === 'verify_ads');
    assert.ok(t);
    assert.deepEqual([...t.inputSchema.required].sort(), ['log_path', 'xlsx_path']);
    assert.equal(t.annotations.readOnlyHint, false, 'tool này ghi file report');
    assert.equal(t.annotations.destructiveHint, false, 'không bao giờ ghi đè hay xóa');
    assert.ok(t.outputSchema);

    const res = await client.callTool({
      name: 'verify_ads',
      arguments: { log_path: f.logPath, xlsx_path: f.xlsxPath, out_dir: tmpDir() },
    });
    assert.ok(!res.isError, JSON.stringify(res.content));
    assert.equal(res.structuredContent.counts.fail, 2);
    assert.ok(fs.existsSync(res.structuredContent.report_path));

    const bad = await client.callTool({ name: 'verify_ads', arguments: { log_path: '/khong/co.txt', xlsx_path: '/khong/co.xlsx' } });
    assert.equal(bad.isError, true);
    assert.ok(bad.content[0].text.startsWith('Lỗi:'));
  } finally {
    await client.close();
  }
});
