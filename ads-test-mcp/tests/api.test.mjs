import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runParseLogcat, runSearchLogcat } from '../dist/core/api.js';
import { validateInputFile } from '../dist/core/validate.js';
import { ToolError } from '../dist/core/errors.js';
import {
  makeLog,
  tmpFile,
  configBlock,
  ID,
  PKG,
  loadStart,
  loadOk,
  loadErr,
  failureTag,
  show,
} from './fixtures.mjs';

function buildLog(adCount = 40) {
  const items = [
    ...configBlock('10:00:00.000', {
      version: '4.20.0',
      prefs: { fo_a: 'true', fo_b: 'false', adjust_token: 'TOPSECRET' },
      checklist: { 'AD_UNITS - X': { fo_ad_x: ID(1), fo_ad_y: ID(2) } },
    }),
  ];
  for (let i = 1; i <= adCount; i++) {
    const sec = String(i % 50).padStart(2, '0');
    items.push(loadStart(`10:01:${sec}.000`, 'Native', ID(i)));
    if (i % 3 === 0) {
      items.push(loadErr(`10:01:${sec}.500`, 'Native', ID(i)));
    } else {
      items.push(loadOk(`10:01:${sec}.500`, 'Native', ID(i)));
      items.push(show(`10:01:${sec}.900`, 'NATIVE', ID(i)));
    }
  }
  items.push({ t: '10:05:00.000', tag: 'FOR_TESTER_CONFIG', msg: 'Adjust config token: TOPSECRET' });
  return makeLog(items);
}

// ------------------------------------------------------------ validate

test('đường dẫn: bắt buộc tuyệt đối, tồn tại, là file thường', () => {
  assert.throws(() => validateInputFile('relative/log.txt', 'log_path'), ToolError);
  assert.throws(() => validateInputFile('', 'log_path'), ToolError);
  assert.throws(() => validateInputFile(42, 'log_path'), ToolError);
  assert.throws(() => validateInputFile('/khong/ton/tai/log.txt', 'log_path'), ToolError);
  assert.throws(() => validateInputFile(os.tmpdir(), 'log_path'), /file thường/);
});

test('đường dẫn: từ chối symlink và file quá giới hạn kích thước', () => {
  const real = tmpFile('x'.repeat(100));
  const link = path.join(path.dirname(real), 'link.txt');
  fs.symlinkSync(real, link);
  assert.throws(() => validateInputFile(link, 'log_path'), /symlink/);
  assert.throws(() => validateInputFile(real, 'log_path', 50), /giới hạn/);
  assert.equal(validateInputFile(real, 'log_path'), real);
});

test('thông báo lỗi không lộ đường dẫn người dùng truyền vào', () => {
  const p = '/duong/dan/rieng/tu/bi-mat.txt';
  try {
    validateInputFile(p, 'log_path');
    assert.fail('phải ném lỗi');
  } catch (e) {
    assert.ok(e instanceof ToolError);
    assert.ok(!e.message.includes('bi-mat'));
  }
});

// ------------------------------------------------------------ parse_logcat

test('parse_logcat: package, version lib, số entry, thời gian, đếm ad đúng', () => {
  const f = tmpFile(buildLog(10));
  const { result: r, text } = runParseLogcat({ log_path: f });
  assert.equal(r.package, PKG);
  assert.equal(r.lib_version, '4.20.0');
  assert.equal(r.time_range.first, '2026-10-24 10:00:00.000');
  assert.equal(r.ads.total, 10);
  assert.equal(r.unparsed_lines, 0);
  // ad 3, 6, 9 fail; 7 ad còn lại load ok và show
  const rows = Object.fromEntries(r.ads.rows.map((x) => [x.id, x]));
  assert.equal(rows[ID(3)].fail, 1);
  assert.equal(rows[ID(3)].show, 0);
  assert.equal(rows[ID(1)].ok, 1);
  assert.equal(rows[ID(1)].show, 1);
  assert.match(text, /10 ad id/);
  assert.match(text, /dữ liệu không đáng tin cậy/);
});

test('parse_logcat: phân trang bảng ad bằng ad_offset và ad_limit', () => {
  const f = tmpFile(buildLog(40));
  const p1 = runParseLogcat({ log_path: f, ad_limit: 15 }).result.ads;
  assert.equal(p1.rows.length, 15);
  assert.equal(p1.total, 40);
  assert.equal(p1.next_offset, 15);
  const p3 = runParseLogcat({ log_path: f, ad_offset: 30, ad_limit: 15 }).result.ads;
  assert.equal(p3.rows.length, 10);
  assert.equal(p3.next_offset, null);
  assert.equal(p3.rows[0].id, ID(31));
});

test('parse_logcat: mặc định gọn, include_config mới kèm giá trị và che secret', () => {
  const f = tmpFile(buildLog(40));
  const def = runParseLogcat({ log_path: f }).result;
  assert.equal(def.remote_config.values, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(def)) < 3500, 'kết quả mặc định phải khoảng 3 KB');

  const full = runParseLogcat({ log_path: f, include_config: true }).result;
  assert.equal(full.remote_config.values.prefs.fo_a, 'true');
  assert.equal(full.remote_config.values.checklist.fo_ad_x, ID(1));
  assert.ok(!JSON.stringify(full).includes('TOPSECRET'));

  const filtered = runParseLogcat({ log_path: f, include_config: true, config_filter: 'FO_AD' }).result;
  assert.deepEqual(Object.keys(filtered.remote_config.values.prefs), []);
  assert.deepEqual(Object.keys(filtered.remote_config.values.checklist).sort(), ['fo_ad_x', 'fo_ad_y']);
});

test('parse_logcat: cảnh báo log chưa lọc theo FOR_TESTER_ và tối đa 5 cảnh báo', () => {
  const items = [
    { t: '10:00:00.000', tag: 'OtherTag', msg: 'noise' },
    loadStart('10:00:01.000', 'Native', ID(1)),
  ];
  const f = tmpFile(makeLog(items) + '--------- beginning of main\n');
  const { result } = runParseLogcat({ log_path: f });
  assert.ok(result.warnings.some((w) => w.includes('chưa lọc')));
  assert.ok(result.warnings.some((w) => w.includes('không đọc được')));
  assert.ok(result.warnings.length <= 5);
  assert.equal(result.ads.total, 1);
});

test('parse_logcat: tham số sai kiểu hoặc ngoài khoảng bị từ chối ở phía server', () => {
  const f = tmpFile(buildLog(3));
  assert.throws(() => runParseLogcat({ log_path: f, ad_limit: 0 }), ToolError);
  assert.throws(() => runParseLogcat({ log_path: f, ad_limit: 101 }), ToolError);
  assert.throws(() => runParseLogcat({ log_path: f, ad_limit: '5' }), ToolError);
  assert.throws(() => runParseLogcat({ log_path: f, ad_offset: -1 }), ToolError);
  assert.throws(() => runParseLogcat({ log_path: f, include_config: 'yes' }), ToolError);
  assert.throws(() => runParseLogcat({ log_path: f, config_filter: 'x'.repeat(65) }), ToolError);
  assert.throws(() => runParseLogcat({}), ToolError);
});

// ------------------------------------------------------------ search_logcat

test('search_logcat: lọc theo tag (bỏ tiền tố), text, ad_id', () => {
  const f = tmpFile(buildLog(10));
  const byTag = runSearchLogcat({ log_path: f, tag: 'SHOW_AD' }).result;
  assert.equal(byTag.total_matched, 7);
  assert.ok(byTag.matches.every((m) => m.tag === 'FOR_TESTER_SHOW_AD'));

  const byAd = runSearchLogcat({ log_path: f, ad_id: ID(3) }).result;
  assert.equal(byAd.total_matched, 2); // load start + load error
  const both = runSearchLogcat({ log_path: f, ad_id: ID(3), text: 'load error' }).result;
  assert.equal(both.total_matched, 1);
});

test('search_logcat: dừng ở 30 entry, mặc định 10, phân trang bằng cursor không sót không lặp', () => {
  const f = tmpFile(buildLog(40));
  assert.equal(runSearchLogcat({ log_path: f, tag: 'LOAD_AD' }).result.matches.length, 10);
  assert.throws(() => runSearchLogcat({ log_path: f, tag: 'LOAD_AD', limit: 31 }), ToolError);

  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const r = runSearchLogcat({ log_path: f, tag: 'LOAD_AD', limit: 30, cursor }).result;
    assert.ok(r.matches.length <= 30);
    seen.push(...r.matches.map((m) => m.index));
    cursor = r.next_cursor ?? undefined;
    pages++;
  } while (cursor);
  const total = runSearchLogcat({ log_path: f, tag: 'LOAD_AD' }).result.total_matched;
  assert.equal(seen.length, total);
  assert.equal(new Set(seen).size, total);
  assert.ok(pages > 1);
});

test('search_logcat: entry cắt khoảng 300 ký tự và che giá trị secret', () => {
  const long = 'y'.repeat(1000);
  const items = [
    { t: '10:00:00.000', tag: 'FOR_TESTER_FO', msg: long },
    { t: '10:00:01.000', tag: 'FOR_TESTER_CONFIG', msg: 'Adjust config token: TOPSECRET' },
  ];
  const f = tmpFile(makeLog(items));
  const long1 = runSearchLogcat({ log_path: f, tag: 'FO' }).result.matches[0].text;
  assert.ok(long1.length <= 303);
  assert.ok(long1.endsWith('...'));
  const tok = runSearchLogcat({ log_path: f, text: 'token' }).result.matches[0].text;
  assert.ok(!tok.includes('TOPSECRET'));
  assert.match(tok, /token: \*\*\*/);
});

test('search_logcat: gộp dòng nhiều dòng thành một entry, dùng ký hiệu xuống dòng', () => {
  const items = [{ t: '10:00:00.000', tag: 'FOR_TESTER_FO', msg: 'đầu', more: ['dòng hai', 'dòng ba'] }];
  const f = tmpFile(makeLog(items));
  const m = runSearchLogcat({ log_path: f, text: 'dòng ba' }).result.matches[0];
  assert.equal(m.text, 'đầu ⏎ dòng hai ⏎ dòng ba');
});

test('search_logcat: ad_id và tag sai định dạng bị từ chối, cursor sai bị từ chối', () => {
  const f = tmpFile(buildLog(3));
  assert.throws(() => runSearchLogcat({ log_path: f, ad_id: 'a b; rm -rf' }), ToolError);
  assert.throws(() => runSearchLogcat({ log_path: f, tag: 'LOAD AD!' }), ToolError);
  assert.throws(() => runSearchLogcat({ log_path: f, cursor: 'abc' }), ToolError);
  assert.throws(() => runSearchLogcat({ log_path: f, text: 'x'.repeat(201) }), ToolError);
});

test('fail in lặp: số liệu tổng hợp trong parse_logcat không đếm gấp đôi', () => {
  const items = [
    loadStart('10:00:00.000', 'Interstitial', ID(1)),
    loadErr('10:00:01.000', 'Interstitial', ID(1)),
    failureTag('10:00:01.001', 'INTERSTITIAL', ID(1)),
  ];
  const f = tmpFile(makeLog(items));
  const row = runParseLogcat({ log_path: f }).result.ads.rows[0];
  assert.equal(row.fail, 1);
});
