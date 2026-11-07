import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogcat, matchesFilter } from '../dist/core/logcat.js';
import { decodeText } from '../dist/core/validate.js';
import { ToolError } from '../dist/core/errors.js';
import { makeLog, ID } from './fixtures.mjs';

const items = [
  { t: '10:00:00.001', tag: 'FOR_TESTER_CONFIG', msg: 'header', more: ['a: 1', 'b: 2'] },
  { t: '10:00:00.002', tag: 'FOR_TESTER_LOAD_AD', level: 'D', msg: `Native ad:Ad with id (${ID(1)}) starting load ad ...` },
  { t: '10:00:01.500', tag: 'FOR_TESTER_SHOW_AD', level: 'E', msg: `NATIVE - ${ID(1)}` },
];

test('gộp dòng tiếp theo vào entry trước, đếm đúng entry và dòng', () => {
  const p = parseLogcat(makeLog(items));
  assert.equal(p.entries.length, 3);
  assert.equal(p.totalLines, 5);
  assert.equal(p.unparsedLines, 0);
  assert.deepEqual(p.entries[0].extra, ['a: 1', 'b: 2']);
  assert.equal(p.entries[0].line, 1);
  assert.equal(p.entries[1].line, 4);
  assert.equal(p.entries[2].tag, 'FOR_TESTER_SHOW_AD');
  assert.equal(p.entries[2].level, 'E');
  assert.equal(p.entries[2].pkg, 'com.example.fakeapp');
});

test('xử lý CRLF giống file xuất từ Windows', () => {
  const p = parseLogcat(makeLog(items, { eol: '\r\n' }));
  assert.equal(p.entries.length, 3);
  assert.equal(p.entries[0].message, 'header');
  assert.equal(p.unparsedLines, 0);
});

test('dòng không có timestamp và không thụt lề được đếm là không đọc được', () => {
  const text = makeLog(items) + '--------- beginning of main\n';
  const p = parseLogcat(text);
  assert.equal(p.entries.length, 3);
  assert.equal(p.unparsedLines, 1);
});

test('file không phải logcat bị từ chối, thông báo không chứa nội dung file', () => {
  const secret = 'NOI-DUNG-BI-MAT-XYZ';
  const junk = Array.from({ length: 40 }, () => `${secret} hello world`).join('\n');
  assert.throws(
    () => parseLogcat(junk),
    (e) => e instanceof ToolError && e.message.startsWith('Lỗi:') && !e.message.includes(secret),
  );
  assert.throws(() => parseLogcat(''), ToolError);
});

test('giải mã BOM UTF-8 và UTF-16 LE/BE, UTF-16 không BOM', () => {
  const text = makeLog(items);
  const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const leNoBom = Buffer.from(text, 'utf16le');
  const be = Buffer.from(Buffer.from(text, 'utf16le'));
  be.swap16();
  const beBom = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
  for (const buf of [utf8Bom, le, leNoBom, beBom]) {
    assert.equal(parseLogcat(decodeText(buf)).entries.length, 3);
  }
});

test('matchesFilter: tag bỏ được tiền tố, text không phân biệt hoa thường, ad_id', () => {
  const p = parseLogcat(makeLog(items));
  const [cfg, load, shw] = p.entries;
  assert.ok(matchesFilter(load, { tag: 'load_ad' }));
  assert.ok(matchesFilter(load, { tag: 'FOR_TESTER_LOAD_AD' }));
  assert.ok(!matchesFilter(cfg, { tag: 'LOAD_AD' }));
  assert.ok(matchesFilter(cfg, { text: 'B: 2' })); // tìm trong cả dòng tiếp theo
  assert.ok(matchesFilter(shw, { adId: ID(1) }));
  assert.ok(!matchesFilter(shw, { adId: ID(2) }));
  assert.ok(!matchesFilter(load, { tag: 'LOAD_AD', text: 'không có' }));
});
