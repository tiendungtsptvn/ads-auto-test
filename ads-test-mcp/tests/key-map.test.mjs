import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseLogcat } from '../dist/core/logcat.js';
import { analyzeAds } from '../dist/core/ad-events.js';
import { extractConfig } from '../dist/core/config.js';
import { readAdScript } from '../dist/core/ad-script.js';
import { verifyAds } from '../dist/core/verify.js';
import { guessKey, mapRemoteKeys, parseKeyOverrides } from '../dist/core/key-map.js';
import { renderReport } from '../dist/core/report.js';
import { mapKeysFiles } from '../dist/core/key-map-tool.js';
import { verifyFiles } from '../dist/core/verify-tool.js';
import { ToolError } from '../dist/core/errors.js';
import { makeLog, configBlock, ID, loadStart, loadOk, show } from './fixtures.mjs';
import { scriptSheetRows, sheetData, xlsxFile } from './xlsx-fixtures.mjs';
import { integrationFiles } from './verify-fixtures.mjs';
import { COND, P, template, consoleCfg, fakeExec } from './rc-fixtures.mjs';

const script = (ads) => readAdScript(sheetData(scriptSheetRows(ads)));
const cv = (key, valueType = 'BOOLEAN') => ({ key, group: null, valueType, value: 'true', origin: 'default' });

// ------------------------------------------------------------ suy key theo tên (D-098)

test('guessKey: bỏ "ad", dấu HF hf/2ID, so cả dạng viết liền; chỉ xét key BOOLEAN', () => {
  const keys = [
    cv('fo_banner_splash'),
    cv('fo_hf_banner_splash'),
    cv('fo_na_fu_af_02'),
    cv('fo_na_fu_af_02_2ID'),
    cv('fo_ui_na_fu_af_02', 'STRING'),
    cv('native_medium'),
    cv('native_medium_2ID'),
  ];
  assert.deepEqual(guessKey('fo_ad_banner_splash', false, keys), { status: 'found', key: 'fo_banner_splash', score: 1 });
  assert.equal(guessKey('fo_ad_banner_splash_hf', true, keys).key, 'fo_hf_banner_splash');
  assert.equal(guessKey('fo_nafu_af_02', false, keys).key, 'fo_na_fu_af_02', 'viết liền "nafu" khớp "na_fu"');
  assert.equal(guessKey('fo_nafu_af_02_2', true, keys).key, 'fo_na_fu_af_02_2ID', 'HF chỉ có hậu tố _2');
  assert.equal(guessKey('native_medium_2ID', true, keys).key, 'native_medium_2ID', 'ad in-app dùng Ads name');
  assert.deepEqual(guessKey('fo_ad_survey', false, keys), { status: 'not_found' });
  assert.equal(guessKey('fo_ad_y_z', false, [cv('fo_x_a'), cv('fo_y_b')]).status, 'not_found', 'dưới ngưỡng thì không đoán');
  assert.equal(guessKey('fo_ad_banner_splash', true, keys).key, 'fo_hf_banner_splash', 'dòng HF chỉ khớp key HF');
  const tie = guessKey('fo_ad_inter_a_b', false, [cv('fo_inter_a'), cv('fo_inter_b')]);
  assert.deepEqual(tie, { status: 'ambiguous', candidates: ['fo_inter_a', 'fo_inter_b'], score: 0.75 });
});

test('parseKeyOverrides: dòng là số, 1 đến 10 key, chuỗi tách theo dấu phẩy', () => {
  assert.equal(parseKeyOverrides(undefined), undefined);
  assert.deepEqual([...parseKeyOverrides({ 12: ['k1'], 13: 'k2, k3' })], [[12, ['k1']], [13, ['k2', 'k3']]]);
  assert.throws(() => parseKeyOverrides([]), ToolError);
  assert.throws(() => parseKeyOverrides({ abc: ['k'] }), /không phải số dòng/);
  assert.throws(() => parseKeyOverrides({ 1: [] }), /1 đến 10 key/);
  assert.throws(() => parseKeyOverrides({ 1: ['k; rm'] }), /tên key/);
});

// ------------------------------------------------------------ bảng mapping (D-098, D-104)

const TPL = template({
  params: {
    banner_all: P('BOOLEAN', 'true'),
    unlock_episode: P('NUMBER', '1', '2'),
  },
  groups: {
    Splash: { fo_banner_splash: P('BOOLEAN', 'true'), fo_inter_splash: P('BOOLEAN', 'true', 'false'), fo_k_script: P('BOOLEAN', 'false') },
  },
});

test('mapRemoteKeys: tester sửa > kịch bản > nghiệm thu > suy theo tên; ghi chú key thiếu, không có trên console, không phải true/false', () => {
  const s = script([
    { name: 'banner_splash', res: 'fo_ad_banner_splash', id: ID(1) }, // dòng 5: suy theo tên
    { name: 'inter_splash', res: 'fo_ad_inter_splash', key: 'fo_k_script', id: ID(2) }, // dòng 6: kịch bản
    { name: 'banner_all', id: ID(3), type: 'Banner' }, // dòng 7: ad in-app, suy theo Ads name
    { name: 'native_x', res: 'fo_ad_native_x', id: ID(4) }, // dòng 8: không tìm được
    { name: 'native_y', res: 'fo_ad_native_y', id: ID(5) }, // dòng 9: nghiệm thu
    { name: 'native_z', res: 'fo_ad_native_z', key: 'not_on_console', id: ID(6) }, // dòng 10
    { name: 'native_n', res: 'fo_ad_native_n', id: ID(7) }, // dòng 11: tester sửa sang key NUMBER
  ]);
  const acceptance = {
    findKey: ({ resource }) =>
      resource === 'fo_ad_native_y'
        ? { status: 'found', key: 'fo_inter_splash', by: 'resource', needle: resource, section: 'Mục Y', ref: 'D9' }
        : { status: 'not_found', reason: `không có ${resource}` },
  };
  const map = mapRemoteKeys(s, consoleCfg(TPL), acceptance, new Map([[11, ['UNLOCK_EPISODE']]]));
  const at = (row) => map.find((m) => m.row === row);

  assert.deepEqual(at(5).keys.map((k) => [k.key, k.source]), [['fo_banner_splash', 'guess']]);
  assert.match(at(5).notes[0], /suy theo tên, tester xác nhận/);
  assert.deepEqual(at(6).keys.map((k) => [k.key, k.source, k.console.value]), [['fo_k_script', 'script', 'false']]);
  assert.deepEqual(at(7).keys.map((k) => [k.key, k.source]), [['banner_all', 'guess']]);
  assert.equal(at(8).keys.length, 0);
  assert.equal(at(8).complete, false);
  assert.match(at(8).notes[0], /fo_ad_native_x: không tìm được key \(file nghiệm thu: không có fo_ad_native_x; không có key gần giống/);
  assert.deepEqual(at(9).keys.map((k) => [k.key, k.source, k.detail]), [['fo_inter_splash', 'acceptance', 'mục "Mục Y", ô D9']]);
  assert.equal(at(9).keys[0].console.origin, 'condition');
  assert.equal(at(10).keys[0].console, null);
  assert.match(at(10).notes[0], /not_on_console không có trên console/);
  assert.deepEqual(at(11).keys.map((k) => [k.key, k.source]), [['unlock_episode', 'tester']], 'lấy đúng tên trên console');
  assert.match(at(11).notes[0], /kiểu NUMBER.*test thủ công \(D-099\)/);
});

// ------------------------------------------------------------ verify_ads lấy trạng thái từ console (D-097, D-101, D-102)

function runWithConsole({ ads, log, tpl, overrides }) {
  const s = script(ads);
  const parsed = parseLogcat(makeLog(log));
  const l = { parsed, ads: analyzeAds(parsed.entries), config: extractConfig(parsed.entries) };
  const cfg = consoleCfg(tpl);
  const keyMap = mapRemoteKeys(s, cfg, undefined, overrides);
  return verifyAds({ script: s, log: l, console: cfg, keyMap });
}
const check = (res, row, id) => res.rows.find((r) => r.row.row === row).checks.find((c) => c.check === id);

test('console là chuẩn: log in key = true nhưng console = false thì ad vắng mặt là OK; console = true mà vắng mặt là FAIL', () => {
  const res = runWithConsole({
    ads: [
      { name: 'a', res: 'fo_a', key: 'k_off', id: ID(1) },
      { name: 'b', res: 'fo_b', key: 'k_on', id: ID(2) },
    ],
    log: configBlock('10:00:00.000', { prefs: { k_off: 'true', k_on: 'false' }, checklist: { S: { fo_a: ID(1), fo_b: ID(2) } } }),
    tpl: template({ params: { k_off: P('BOOLEAN', 'true', 'false'), k_on: P('BOOLEAN', 'true') } }),
  });
  assert.equal(check(res, 5, 'present').status, 'OK');
  assert.match(check(res, 5, 'present').message, /console, D-102/);
  assert.equal(check(res, 6, 'present').status, 'FAIL');
  assert.equal(res.console.condition, COND);
  assert.equal(res.keyMap.length, 2);
  assert.match(res.notes[0], /lấy từ console: project demo-project-01, condition tester1\.0\.0.*template version 25/);
});

test('console = false mà ID vẫn load hoặc show thì key_false FAIL, kể cả khi log in key = true', () => {
  const res = runWithConsole({
    ads: [{ name: 'a', res: 'fo_a', key: 'k1', id: ID(1) }],
    log: [
      ...configBlock('10:00:00.000', { prefs: { k1: 'true' }, checklist: { S: { fo_a: ID(1) } } }),
      loadStart('10:00:01.000', 'Native', ID(1)),
      loadOk('10:00:02.000', 'Native', ID(1)),
      show('10:00:03.000', 'NATIVE', ID(1)),
    ],
    tpl: template({ params: { k1: P('BOOLEAN', 'false') } }),
  });
  const c = check(res, 5, 'key_false');
  assert.equal(c.status, 'FAIL');
  assert.equal(c.evidence.length, 2);
});

test('ad in-app (không ghi resource, key) lấy key qua mapping; key không phải true/false thì CẦN XEM để test thủ công (D-099)', () => {
  const res = runWithConsole({
    ads: [
      { name: 'banner_all', id: ID(1), type: 'Banner' },
      { name: 'unlock_episode', id: ID(2) },
    ],
    log: configBlock('10:00:00.000', { prefs: {}, checklist: {} }),
    tpl: template({ params: { banner_all: P('BOOLEAN', 'false'), unlock_episode: P('NUMBER', '2') } }),
    overrides: new Map([[6, ['unlock_episode']]]),
  });
  assert.equal(check(res, 5, 'present').status, 'OK', 'banner_all = false trên console');
  const manual = check(res, 6, 'present');
  assert.equal(manual.status, 'REVIEW');
  assert.match(manual.message, /test thủ công \(D-099\)/);
  assert.ok(!res.notes.some((n) => /cần console \(key lấy từ Firebase/.test(n)), 'không còn ghi chú "cần console"');
});

test('report có metadata console và bảng mapping', () => {
  const res = runWithConsole({
    ads: [{ name: 'a', res: 'fo_ad_a', id: ID(1) }],
    log: configBlock('10:00:00.000', { prefs: {}, checklist: { S: { fo_ad_a: ID(1) } } }),
    tpl: template({ params: { fo_a: P('BOOLEAN', 'true') } }),
  });
  const text = renderReport(res, {
    generatedAt: new Date(0),
    packageName: 'p',
    libVersion: null,
    logFile: 'l.txt',
    logFirst: 'a',
    logLast: 'b',
    scriptFile: 's.xlsx',
    sheet: 'S',
  });
  assert.match(text, /^rc_condition: "tester1\.0\.0"$/m);
  assert.match(text, /^key_source: console$/m);
  assert.match(text, /## Mapping key remote \(1\)/);
  assert.match(text, /\| 5 \| a \| `fo_ad_a` \| `fo_a` \| suy theo tên/);
});

// ------------------------------------------------------------ tool: map_remote_keys và verify_ads có console

test('mapKeysFiles: ghi key-map-*.md cạnh file kịch bản, không ghi đè; trả bảng gọn', async () => {
  const files = await integrationFiles();
  const f = fakeExec({ status: 'success', result: template({ params: { k_ok: P('BOOLEAN', 'true'), k_gone: P('BOOLEAN', 'false', 'true') } }) });
  const now = new Date(2026, 10, 8, 10, 0, 0);
  const opts = { xlsxPath: files.xlsxPath, firebaseProjectId: 'demo-project-01', version: '1.0.0', outDir: files.dir, now, rcRead: f };
  const { result, text } = await mapKeysFiles(opts);
  const again = await mapKeysFiles(opts);
  assert.notEqual(result.report_path, again.report_path, 'không ghi đè');
  assert.match(path.basename(result.report_path), /^key-map-20261108-100000\.md$/);
  assert.equal(result.condition, COND);
  assert.equal(result.counts.ads, 4);
  assert.equal(result.rows.items.find((r) => r.row === 6).keys[0].value, 'true');
  assert.match(text, /chỉ gọi verify_ads .* sau khi tester đồng ý/);
  const md = fs.readFileSync(result.report_path, 'utf8');
  assert.match(md, /# Bảng mapping key remote/);
  assert.ok(!md.includes('nguoi-cap-nhat'), 'không lưu email người cập nhật');
});

test('verifyFiles với console: key_source console; project và version phải đi cùng; key_overrides cần console', async () => {
  const files = await integrationFiles();
  const f = fakeExec({ status: 'success', result: template({ params: { k_ok: P('BOOLEAN', 'true'), k_gone: P('BOOLEAN', 'true', 'false'), k_rw: P('BOOLEAN', 'true') } }) });
  const base = { logPath: files.logPath, xlsxPath: files.xlsxPath, outDir: files.dir };
  const { result, text } = await verifyFiles({ ...base, firebaseProjectId: 'demo-project-01', version: '1.0.0', rcRead: f });
  assert.deepEqual(result.key_source, { from: 'console', firebase_project: 'demo-project-01', condition: COND });
  assert.match(text, /lấy từ console/);
  // ad_gone (dòng 6) vắng mặt, console tắt k_gone theo condition tester
  assert.ok(!result.fail.items.some((i) => i.row === 6));
  await assert.rejects(verifyFiles({ ...base, firebaseProjectId: 'demo-project-01' }), /đi cùng nhau/);
  await assert.rejects(verifyFiles({ ...base, keyOverrides: { 5: ['k'] } }), /key_overrides chỉ dùng khi có/);
});

test('mapKeysFiles: template không có condition của version thì báo lỗi kèm các condition đang có', async () => {
  const files = await integrationFiles();
  const xlsx = await xlsxFile([{ name: 'S', rows: scriptSheetRows([{ name: 'a', res: 'fo_a', key: 'k', id: ID(1) }]) }]);
  const f = fakeExec({ status: 'success', result: template() });
  await assert.rejects(
    mapKeysFiles({ xlsxPath: xlsx, firebaseProjectId: 'demo-project-01', version: '2.0.0', outDir: files.dir, rcRead: f }),
    (e) => e instanceof ToolError && /Tester_2\.0\.0/.test(e.message) && /"tester1\.0\.0"/.test(e.message),
  );
});
