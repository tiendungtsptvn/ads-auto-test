import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogcat } from '../dist/core/logcat.js';
import { analyzeAds } from '../dist/core/ad-events.js';
import { extractConfig } from '../dist/core/config.js';
import { readAdScript } from '../dist/core/ad-script.js';
import { verifyAds, failThenShow, loadMoreThanOnce, highFloorViolations, loneResults } from '../dist/core/verify.js';
import { makeLog, configBlock, ID, loadStart, loadOk, loadErr, show } from './fixtures.mjs';
import { scriptSheetRows, sheetData } from './xlsx-fixtures.mjs';

// ------------------------------------------------------------ dựng tình huống

/** ads: các dòng kịch bản (xem scriptSheetRows, dữ liệu từ dòng 5); log: các item của makeLog. */
function scenario({ ads, log, acceptance }) {
  const script = readAdScript(sheetData(scriptSheetRows(ads)));
  const parsed = parseLogcat(makeLog(log));
  const l = { parsed, ads: analyzeAds(parsed.entries), config: extractConfig(parsed.entries) };
  return verifyAds({ script, log: l, acceptance });
}
const verdict = (res, row) => res.rows.find((r) => r.row.row === row);
const check = (res, row, id) => verdict(res, row).checks.find((c) => c.check === id);
const cfg = (checklist, prefs, t = '10:00:00.000') => configBlock(t, { prefs, checklist });

/** Một ad thường: dòng 5, key k1. */
const ONE = [{ name: 'a', res: 'fo_a', key: 'k1', id: ID(1) }];
const ONE_CFG = cfg({ S: { fo_a: ID(1) } }, { k1: 'true' });

// event giả để test thuần các rule theo timeline
let seq = 0;
const ev = (kind, entryIndex, id = ID(1)) => ({
  kind,
  id,
  adType: 'Native',
  time: `2026-10-24 10:00:${String(entryIndex).padStart(2, '0')}.000`,
  ms: entryIndex * 1000,
  entryIndex,
  line: entryIndex + 1,
  seq: seq++,
});
const HF = ID(2);
const hf = (kind, i) => ev(kind, i, HF);
const nm = (kind, i) => ev(kind, i, ID(1));

// ------------------------------------------------------------ rule (d): fail thì không show

test('D-063 d: show sau load fail mà chưa có load thành công mới là vi phạm', () => {
  assert.equal(failThenShow([ev('load_start', 0), ev('load_fail', 1), ev('show', 2)]).length, 1);
  assert.deepEqual(failThenShow([ev('load_start', 0), ev('load_fail', 1), ev('load_ok', 2), ev('show', 3)]), []);
  assert.deepEqual(failThenShow([ev('load_ok', 0), ev('show', 1), ev('show', 2)]), []);
  assert.equal(failThenShow([ev('load_fail', 0), ev('show', 1), ev('show', 2)]).length, 2, 'mỗi lần show đều là một vi phạm');
});

// ------------------------------------------------------------ rule (e): load một lần trước show

test('D-063 e: hai lần bắt đầu load liên tiếp không có show hoặc fail ở giữa là vi phạm', () => {
  assert.equal(loadMoreThanOnce([ev('load_start', 0), ev('load_start', 1), ev('load_ok', 2), ev('show', 3)]).length, 1);
  assert.deepEqual(loadMoreThanOnce([ev('load_start', 0), ev('load_ok', 1), ev('show', 2), ev('load_start', 3)]), []);
  assert.deepEqual(loadMoreThanOnce([ev('load_start', 0), ev('load_fail', 1), ev('load_start', 2)]), [], 'fail ở giữa thì được load lại');
  const reload = loadMoreThanOnce([ev('load_start', 0), ev('load_ok', 1), ev('load_start', 2)]);
  assert.equal(reload.length, 1, 'load ok rồi load lại mà chưa show vẫn là vi phạm (D-087)');
  assert.match(reload[0], /đã load ok.*preload hoặc reload.*D-087/);
  assert.match(loadMoreThanOnce([ev('load_start', 0), ev('load_start', 1)])[0], /dòng 1.*dòng 2/);
});

// ------------------------------------------------------------ rule HF (a, b, c)

test('D-063 a, c: HF load trước; HF fail thì ad thường load sau đó là đúng', () => {
  assert.deepEqual(highFloorViolations([hf('load_start', 0), hf('load_fail', 1)], [nm('load_start', 2), nm('load_ok', 3)]), []);
});

test('D-063 b: HF đã load thành công mà ad thường vẫn load là vi phạm', () => {
  const v = highFloorViolations([hf('load_start', 0), hf('load_ok', 1)], [nm('load_start', 2)]);
  assert.equal(v.length, 1);
  assert.match(v[0], /^\(b\)/);
});

test('D-063 a: ad thường load khi HF chưa được load trước là vi phạm', () => {
  const v = highFloorViolations([], [nm('load_start', 0)]);
  assert.equal(v.length, 1);
  assert.match(v[0], /^\(a\)/);
});

test('D-063 c: HF fail mà không thấy ad thường load sau đó là vi phạm; ad thường load khi HF chưa có kết quả cũng vậy', () => {
  const never = highFloorViolations([hf('load_start', 0), hf('load_fail', 1)], []);
  assert.equal(never.length, 1);
  assert.match(never[0], /không thấy ad thường/);
  const early = highFloorViolations([hf('load_start', 0)], [nm('load_start', 1)]);
  assert.match(early[0], /chưa có kết quả/);
});

test('D-086: dòng ok/fail lẻ không có dòng bắt đầu không tính là một lần request', () => {
  const v = highFloorViolations([hf('load_fail', 0)], [nm('load_start', 1), nm('load_ok', 2)]);
  assert.equal(v.length, 1);
  assert.match(v[0], /^\(a\)/, 'fail lẻ của HF không được coi là HF đã load');
  assert.deepEqual(highFloorViolations([hf('load_start', 0), hf('load_fail', 1)], [nm('load_ok', 2)]).length, 1, 'ok lẻ của ad thường không phải request');
});

test('D-086: loneResults đếm số lần bắt đầu đang chờ, hai lần bắt đầu rồi hai kết quả thì không có dòng lẻ', () => {
  assert.deepEqual(loneResults([ev('load_start', 0), ev('load_start', 1), ev('load_ok', 2), ev('load_ok', 3)]), []);
  const lone = loneResults([ev('load_start', 0), ev('load_ok', 1), ev('load_ok', 2), ev('load_fail', 3)]);
  assert.deepEqual(lone.map((e) => e.entryIndex), [2, 3]);
});

test('D-086: dòng lẻ được cảnh báo kèm dòng log và vị trí trong kịch bản, có ghi chú', () => {
  const log = [...ONE_CFG, loadStart('10:00:01.000', 'Native', ID(1)), loadOk('10:00:02.000', 'Native', ID(1)), loadErr('10:00:03.000', 'Native', ID(1))];
  const r = scenario({ ads: ONE, log });
  assert.equal(r.logWarnings.length, 1);
  assert.equal(r.logWarnings[0].kind, 'load_fail');
  assert.deepEqual(r.logWarnings[0].rows.map((x) => x.row), [5]);
  assert.ok(r.logWarnings[0].line > 0);
  assert.match(r.notes[0], /1 dòng load ok\/fail lẻ.*kịch bản dòng 5/);
});

test('rule HF: nhiều vòng, mỗi vòng được xét riêng', () => {
  const ok = highFloorViolations(
    [hf('load_start', 0), hf('load_fail', 1), hf('load_start', 5), hf('load_ok', 6), hf('show', 7)],
    [nm('load_start', 2), nm('load_ok', 3), nm('show', 4)],
  );
  assert.deepEqual(ok, []);
  const bad = highFloorViolations(
    [hf('load_start', 0), hf('load_fail', 1)],
    [nm('load_start', 2), nm('load_ok', 3), nm('show', 4), nm('load_start', 5)],
  );
  assert.equal(bad.length, 1);
  assert.match(bad[0], /^\(a\)/);
});

// ------------------------------------------------------------ kiểm tra "Đúng ID"

test('Đúng ID: khớp thì OK, khác thì FAIL kèm cả hai ID, log trống thì FAIL', () => {
  const ads = [
    { name: 'a', res: 'fo_a', key: 'k1', id: ID(1) }, // 5 khớp
    { name: 'b', res: 'fo_b', key: 'k1', id: ID(2) }, // 6 khác
    { name: 'c', res: 'fo_c', key: 'k1', id: ID(3) }, // 7 log trống
  ];
  const log = cfg({ S: { fo_a: ID(1), fo_b: ID(99), fo_c: '' } }, { k1: 'true' });
  const r = scenario({ ads, log });
  assert.equal(check(r, 5, 'id').status, 'OK');
  assert.equal(check(r, 6, 'id').status, 'FAIL');
  assert.match(check(r, 6, 'id').message, new RegExp(`${ID(2)}.*${ID(99)}`));
  assert.equal(check(r, 7, 'id').status, 'FAIL');
  assert.match(check(r, 7, 'id').message, /\(trống\)/);
});

test('Đúng ID: log không có key thì CẦN XEM; ad dùng Ads name thay resource thì NA; nhiều resource lấy kết quả xấu nhất', () => {
  const ads = [
    { name: 'a', res: 'fo_missing', key: 'k1', id: ID(1) }, // 5
    { name: 'inapp' , id: ID(2) }, // 6: resource lấy từ Ads name
    { name: 'm', res: 'fo_m1\nfo_m2', key: 'k1', id: ID(3) }, // 7: một khớp, một không có
  ];
  const r = scenario({ ads, log: cfg({ S: { fo_m1: ID(3) } }, { k1: 'true' }) });
  assert.equal(check(r, 5, 'id').status, 'REVIEW');
  assert.match(check(r, 5, 'id').message, /fo_missing/);
  assert.equal(check(r, 6, 'id').status, 'NA');
  assert.equal(check(r, 7, 'id').status, 'REVIEW');
  assert.match(check(r, 7, 'id').message, /fo_m2/);
});

test('Đúng ID: giá trị key đổi giữa các lần in CONFIG thì CẦN XEM', () => {
  const log = [...cfg({ S: { fo_a: ID(1) } }, { k1: 'true' }), ...cfg({ S: { fo_a: ID(7) } }, { k1: 'true' }, '10:10:00.000')];
  const r = scenario({ ads: ONE, log });
  assert.equal(check(r, 5, 'id').status, 'REVIEW');
  assert.match(check(r, 5, 'id').message, /đổi giữa các lần in CONFIG/);
});

test('Đúng ID: kịch bản thiếu hoặc sai Ads ID thì CẦN XEM, không đoán', () => {
  const r = scenario({ ads: [{ name: 'a', res: 'fo_a', key: 'k1', id: 'sai-dinh-dang' }], log: ONE_CFG });
  assert.equal(check(r, 5, 'id').status, 'REVIEW');
  assert.equal(verdict(r, 5).status, 'REVIEW');
});

// ------------------------------------------------------------ kiểm tra "Đủ ad" (D-065, D-073)

test('Đủ ad: có trong log thì OK; vắng mặt là FAIL kèm vị trí và gợi ý (D-065)', () => {
  const log = [...ONE_CFG, loadStart('10:00:01.000', 'Native', ID(1))];
  const r = scenario({ ads: ONE, log });
  assert.equal(check(r, 5, 'present').status, 'OK');

  const absent = scenario({ ads: ONE, log: ONE_CFG });
  const c = check(absent, 5, 'present');
  assert.equal(c.status, 'FAIL');
  assert.match(c.message, /không thấy trong log/);
  assert.match(c.message, /k1 = true/);
  assert.equal(verdict(absent, 5).row.row, 5, 'có vị trí dòng để tester tìm nhanh');
  assert.equal(verdict(absent, 5).status, 'FAIL');
});

test('Đủ ad: vắng mặt mà key = false ở mọi lần in CONFIG là đúng (D-073); chỉ tắt ở một lần thì vẫn FAIL', () => {
  const off = scenario({ ads: ONE, log: cfg({ S: { fo_a: ID(1) } }, { k1: 'false' }) });
  assert.equal(check(off, 5, 'present').status, 'OK');
  assert.match(check(off, 5, 'present').message, /key k1 = false/);

  const mixed = scenario({
    ads: ONE,
    log: [...cfg({ S: { fo_a: ID(1) } }, { k1: 'false' }), ...cfg({ S: { fo_a: ID(1) } }, { k1: 'true' }, '10:10:00.000')],
  });
  assert.equal(check(mixed, 5, 'present').status, 'FAIL');
});

test('Đủ ad: ad in-app vắng mặt là FAIL kèm gợi ý cần console; kịch bản không ghi key thì gợi ý khác', () => {
  const r = scenario({ ads: [{ name: 'banner_all', id: ID(1) }, { name: 'x', res: 'fo_x', id: ID(2) }], log: ONE_CFG });
  assert.match(check(r, 5, 'present').message, /cần console M4/);
  assert.match(check(r, 6, 'present').message, /không ghi key/);
});

// ------------------------------------------------------------ kiểm tra "Đúng loại" (D-067)

test('Đúng loại: khớp OK, khác FAIL, loại lạ CẦN XEM, ID vắng thì NA', () => {
  const ads = [
    { name: 'a', res: 'fo_a', key: 'k1', id: ID(1), type: 'Native' }, // 5 khớp
    { name: 'b', res: 'fo_b', key: 'k1', id: ID(2), type: 'Banner' }, // 6 log là Native
    { name: 'c', res: 'fo_c', key: 'k1', id: ID(3), type: 'Splash' }, // 7 loại lạ
    { name: 'd', res: 'fo_d', key: 'k1', id: ID(4), type: 'Native' }, // 8 vắng
  ];
  const log = [
    ...cfg({ S: {} }, { k1: 'true' }),
    loadStart('10:00:01.000', 'Native', ID(1)),
    loadStart('10:00:02.000', 'Native', ID(2)),
    loadStart('10:00:03.000', 'Native', ID(3)),
  ];
  const r = scenario({ ads, log });
  assert.equal(check(r, 5, 'type').status, 'OK');
  assert.equal(check(r, 6, 'type').status, 'FAIL');
  assert.match(check(r, 6, 'type').message, /kịch bản Banner, log Native/);
  assert.equal(check(r, 7, 'type').status, 'REVIEW');
  assert.equal(check(r, 8, 'type').status, 'NA');
});

// ------------------------------------------------------------ fail/show và load một lần theo log

test('log: fail rồi show bị FAIL, load hai lần liên tiếp bị FAIL, kèm bằng chứng thời gian và dòng', () => {
  const ads = [
    { name: 'a', res: 'fo_a', key: 'k1', id: ID(1) }, // 5: fail rồi show
    { name: 'b', res: 'fo_b', key: 'k1', id: ID(2) }, // 6: load 2 lần rồi show (như reward_ad của file mẫu)
  ];
  const log = [
    ...cfg({ S: { fo_a: ID(1), fo_b: ID(2) } }, { k1: 'true' }),
    loadStart('10:00:01.000', 'Native', ID(1)),
    loadErr('10:00:02.000', 'Native', ID(1)),
    show('10:00:03.000', 'NATIVE', ID(1)),
    loadStart('10:00:04.000', 'Native', ID(2)),
    loadStart('10:00:05.000', 'Native', ID(2)),
    loadOk('10:00:06.000', 'Native', ID(2)),
    show('10:00:07.000', 'NATIVE', ID(2)),
  ];
  const r = scenario({ ads, log });
  assert.equal(check(r, 5, 'fail_show').status, 'FAIL');
  assert.match(check(r, 5, 'fail_show').evidence[0], /10:00:02\.000 load_fail.*dòng \d+.*10:00:03\.000 show/);
  assert.equal(check(r, 5, 'load_once').status, 'OK');
  assert.equal(check(r, 6, 'load_once').status, 'FAIL');
  assert.match(check(r, 6, 'load_once').evidence[0], /10:00:04\.000 load_start.*10:00:05\.000 load_start/);
  assert.equal(verdict(r, 5).status, 'FAIL');
  assert.equal(verdict(r, 6).status, 'FAIL');
});

// ------------------------------------------------------------ key false thì không request (D-073)

test('key false: ID vẫn bị request khi key = false là FAIL kèm thời điểm; key true thì OK', () => {
  const ads = [
    { name: 'a', res: 'fo_a', key: 'k_off', id: ID(1) }, // 5
    { name: 'b', res: 'fo_b', key: 'k_on', id: ID(2) }, // 6
  ];
  const log = [
    ...cfg({ S: { fo_a: ID(1), fo_b: ID(2) } }, { k_off: 'false', k_on: 'true' }),
    loadStart('10:00:01.000', 'Native', ID(1)),
    loadStart('10:00:02.000', 'Native', ID(2)),
  ];
  const r = scenario({ ads, log });
  assert.equal(check(r, 5, 'key_false').status, 'FAIL');
  assert.match(check(r, 5, 'key_false').evidence[0], /10:00:01\.000/);
  assert.equal(check(r, 6, 'key_false').status, 'OK');
});

test('key false: tính theo lần in CONFIG có hiệu lực tại thời điểm request (app khởi động lại)', () => {
  const log = [
    ...cfg({ S: { fo_a: ID(1) } }, { k1: 'true' }, '10:00:00.000'),
    loadStart('10:00:01.000', 'Native', ID(1)), // lúc này key bật: đúng
    loadErr('10:00:02.000', 'Native', ID(1)),
    ...cfg({ S: { fo_a: ID(1) } }, { k1: 'false' }, '10:10:00.000'),
    loadStart('10:10:05.000', 'Native', ID(1)), // sau khi tắt: vi phạm
  ];
  const r = scenario({ ads: ONE, log });
  const c = check(r, 5, 'key_false');
  assert.equal(c.status, 'FAIL');
  assert.equal(c.evidence.length, 1);
  assert.match(c.evidence[0], /10:10:05\.000/);
});

test('key false: nhiều key thì chỉ coi là tắt khi mọi key đều false', () => {
  const ads = [{ name: 'a', res: 'fo_a', key: 'k1, k2', id: ID(1) }];
  const mk = (p) => [...cfg({ S: { fo_a: ID(1) } }, p), loadStart('10:00:01.000', 'Native', ID(1))];
  assert.equal(check(scenario({ ads, log: mk({ k1: 'false', k2: 'true' }) }), 5, 'key_false').status, 'OK');
  assert.equal(check(scenario({ ads, log: mk({ k1: 'false', k2: 'false' }) }), 5, 'key_false').status, 'FAIL');
});

test('key false: key không có trong log hoặc ad in-app thì NA với lý do rõ ràng, không kết luận', () => {
  const ads = [
    { name: 'a', res: 'fo_a', key: 'k_khong_co', id: ID(1) }, // 5
    { name: 'banner_all', id: ID(2) }, // 6 in-app
    { name: 'c', res: 'fo_c', id: ID(3) }, // 7 không ghi key
  ];
  const log = [
    ...cfg({ S: {} }, { k1: 'true' }),
    loadStart('10:00:01.000', 'Native', ID(1)),
    loadStart('10:00:02.000', 'Native', ID(2)),
    loadStart('10:00:03.000', 'Native', ID(3)),
  ];
  const r = scenario({ ads, log });
  assert.equal(check(r, 5, 'key_false').status, 'NA');
  assert.match(check(r, 5, 'key_false').message, /không có trong Remote FO Prefs/);
  assert.match(check(r, 6, 'key_false').message, /cần console/);
  assert.match(check(r, 7, 'key_false').message, /không ghi key/);
});

// ------------------------------------------------------------ rule HF qua log và kịch bản

const PAIR_ADS = [
  { name: 'x', res: 'fo_x', key: 'k_n', id: ID(1) }, // 5 thường
  { name: 'x_2ID', res: 'fo_x_hf', key: 'k_h', id: ID(2) }, // 6 HF
];
const PAIR_CFG = (prefs = { k_n: 'true', k_h: 'true' }) => cfg({ S: { fo_x: ID(1), fo_x_hf: ID(2) } }, prefs);

test('rule HF: HF fail rồi ad thường load là OK, kết quả gắn vào dòng HF, dòng thường có tham chiếu', () => {
  const log = [
    ...PAIR_CFG(),
    loadStart('10:00:01.000', 'Native', ID(2)),
    loadErr('10:00:02.000', 'Native', ID(2)),
    loadStart('10:00:02.100', 'Native', ID(1)),
    loadOk('10:00:03.000', 'Native', ID(1)),
    show('10:00:03.100', 'NATIVE', ID(1)),
  ];
  const r = scenario({ ads: PAIR_ADS, log });
  assert.equal(check(r, 6, 'hf_order').status, 'OK');
  assert.equal(check(r, 5, 'hf_order').status, 'NA');
  assert.match(check(r, 5, 'hf_order').message, /dòng 6/);
  assert.equal(r.pairs.length, 1);
  assert.deepEqual([r.pairs[0].hfRow, r.pairs[0].normalRow, r.pairs[0].status], [6, 5, 'OK']);
  assert.ok(r.pairs[0].lines.some((l) => l.startsWith('HF')));
  assert.ok(r.pairs[0].lines.some((l) => l.startsWith('thường')));
});

test('rule HF: HF load thành công mà ad thường vẫn load là FAIL kèm timeline', () => {
  const log = [
    ...PAIR_CFG(),
    loadStart('10:00:01.000', 'Native', ID(2)),
    loadOk('10:00:02.000', 'Native', ID(2)),
    loadStart('10:00:02.500', 'Native', ID(1)),
  ];
  const r = scenario({ ads: PAIR_ADS, log });
  const c = check(r, 6, 'hf_order');
  assert.equal(c.status, 'FAIL');
  assert.match(c.evidence[0], /^\(b\)/);
  assert.equal(verdict(r, 6).status, 'FAIL');
  assert.equal(r.pairs[0].status, 'FAIL');
});

test('rule HF: chưa biết key, hoặc một key = false, hoặc ad in-app thì NA với lý do, vẫn có timeline', () => {
  const log = [
    ...cfg({ S: { fo_x: ID(1), fo_x_hf: ID(2) } }, { k_n: 'true' }), // thiếu k_h
    loadStart('10:00:01.000', 'Native', ID(1)),
  ];
  const unknown = scenario({ ads: PAIR_ADS, log });
  assert.equal(check(unknown, 6, 'hf_order').status, 'NA');
  assert.match(check(unknown, 6, 'hf_order').message, /chưa biết key/);
  assert.equal(unknown.pairs.length, 1);

  const bothOff = scenario({ ads: PAIR_ADS, log: [...PAIR_CFG({ k_n: 'false', k_h: 'false' })] });
  assert.equal(check(bothOff, 6, 'hf_order').status, 'NA');
  assert.match(check(bothOff, 6, 'hf_order').message, /cả hai key = false/);

  const inApp = scenario({
    ads: [{ name: 'banner_x', id: ID(1) }, { name: 'banner_x_2ID', id: ID(2) }],
    log: [...cfg({ S: {} }, { k1: 'true' }), loadStart('10:00:01.000', 'Banner', ID(1))],
  });
  assert.match(check(inApp, 6, 'hf_order').message, /cần console/);
});

test('D-085: chỉ HF bật thì ad thường phải bị bỏ qua; ad thường load hoặc show là FAIL', () => {
  const okLog = [...PAIR_CFG({ k_n: 'false', k_h: 'true' }), loadStart('10:00:01.000', 'Native', ID(2)), loadErr('10:00:02.000', 'Native', ID(2))];
  const ok = scenario({ ads: PAIR_ADS, log: okLog });
  assert.equal(check(ok, 6, 'hf_order').status, 'OK');
  assert.match(check(ok, 6, 'hf_order').message, /chỉ HF bật/);

  const bad = scenario({
    ads: PAIR_ADS,
    log: [...okLog, loadStart('10:00:03.000', 'Native', ID(1)), loadOk('10:00:04.000', 'Native', ID(1)), show('10:00:05.000', 'NATIVE', ID(1))],
  });
  const c = check(bad, 6, 'hf_order');
  assert.equal(c.status, 'FAIL');
  assert.equal(c.evidence.length, 2, 'cả lần load và lần show đều là vi phạm');
  assert.match(c.evidence[1], /show lúc 10:00:05\.000/);
  assert.equal(check(bad, 5, 'key_false').status, 'FAIL', 'dòng ad thường cũng FAIL ở kiểm tra key false');
});

test('D-085: chỉ ad thường bật thì HF phải bị bỏ qua, ad thường load thẳng là đúng', () => {
  const log = [...PAIR_CFG({ k_n: 'true', k_h: 'false' }), loadStart('10:00:01.000', 'Native', ID(1)), loadOk('10:00:02.000', 'Native', ID(1))];
  const r = scenario({ ads: PAIR_ADS, log });
  assert.equal(check(r, 6, 'hf_order').status, 'OK');
  const bad = scenario({ ads: PAIR_ADS, log: [...log, loadStart('10:00:03.000', 'Native', ID(2))] });
  assert.equal(check(bad, 6, 'hf_order').status, 'FAIL');
  assert.match(check(bad, 6, 'hf_order').evidence[0], /HF có key = false nhưng vẫn load/);
});

test('D-085: key false thì show cũng là vi phạm, không chỉ load', () => {
  const log = [...cfg({ S: { fo_a: ID(1) } }, { k1: 'false' }), show('10:00:01.000', 'NATIVE', ID(1))];
  const c = check(scenario({ ads: ONE, log }), 5, 'key_false');
  assert.equal(c.status, 'FAIL');
  assert.match(c.evidence[0], /^show lúc/);
});

test('D-088: nhiều dòng dùng chung một ID thì trạng thái key gộp theo ID, một dòng còn bật thì không FAIL', () => {
  const ads = [
    { name: 'a', res: 'fo_a', key: 'k_off', id: ID(1) }, // 5: key tắt
    { name: 'b', res: 'fo_b', key: 'k_on', id: ID(1) }, // 6: cùng ID, key bật
  ];
  const log = [...cfg({ S: { fo_a: ID(1), fo_b: ID(1) } }, { k_off: 'false', k_on: 'true' }), loadStart('10:00:01.000', 'Native', ID(1))];
  const r = scenario({ ads, log });
  assert.equal(check(r, 5, 'key_false').status, 'OK');
  assert.match(check(r, 5, 'key_false').message, /dùng chung với dòng 6/);

  const absent = scenario({ ads, log: cfg({ S: {} }, { k_off: 'false', k_on: 'true' }) });
  assert.equal(check(absent, 5, 'present').status, 'FAIL', 'ID còn bật qua dòng 6 nên vắng mặt vẫn là FAIL');
  const allOff = scenario({ ads, log: cfg({ S: {} }, { k_off: 'false', k_on: 'false' }) });
  assert.equal(check(allOff, 5, 'present').status, 'OK');
});

// ------------------------------------------------------------ tra key trong file nghiệm thu (D-083)

/** File nghiệm thu giả: findKey trả theo bảng resource -> kết quả. */
const fakeAcceptance = (table) => ({
  sheet: 'NT',
  extract: () => [],
  findKey: ({ resource }) => table[resource] ?? { status: 'not_found', reason: `không có mục nào nhắc tới resource "${resource}"` },
});

test('D-083: dòng có resource mà không ghi key thì tra key trong file nghiệm thu và kiểm như bình thường', () => {
  const ads = [
    { name: 'x', res: 'fo_x', id: ID(1) }, // 5 thường, không ghi key
    { name: 'x_2ID', res: 'fo_x_2', key: 'v', id: ID(2) }, // 6 HF, chỉ có "v"
  ];
  const acceptance = fakeAcceptance({
    fo_x: { status: 'found', key: 'k_n', by: 'resource', needle: 'fo_x', section: 'Ad X', ref: 'D10' },
    fo_x_2: { status: 'found', key: 'k_h', by: 'resource', needle: 'fo_x_2', section: 'Ad X', ref: 'D10' },
  });
  const log = [...PAIR_CFG({ k_n: 'false', k_h: 'true' }), loadStart('10:00:01.000', 'Native', ID(2)), loadOk('10:00:02.000', 'Native', ID(2))];
  const r = scenario({ ads, log, acceptance });
  assert.equal(check(r, 5, 'present').status, 'OK', 'key tra được = false nên vắng mặt là đúng');
  assert.equal(check(r, 6, 'hf_order').status, 'OK');
  assert.deepEqual(r.keyLookups.map((k) => [k.row, k.resource, k.lookup.key]), [[5, 'fo_x', 'k_n'], [6, 'fo_x_2', 'k_h']]);
  assert.ok(r.notes.some((n) => /2 resource không ghi key.*đã tra được/.test(n)));
});

test('D-083: không có file nghiệm thu hoặc không tra được key thì NA kèm lý do cụ thể, không đoán', () => {
  const ads = [{ name: 'x', res: 'fo_x', id: ID(1) }];
  const log = [...cfg({ S: { fo_x: ID(1) } }, { k1: 'true' }), loadStart('10:00:01.000', 'Native', ID(1))];
  const noFile = scenario({ ads, log });
  assert.equal(check(noFile, 5, 'key_false').status, 'NA');
  assert.match(check(noFile, 5, 'key_false').message, /cần file nghiệm thu/);

  const notFound = scenario({ ads, log, acceptance: fakeAcceptance({}) });
  assert.equal(check(notFound, 5, 'key_false').status, 'NA');
  assert.match(check(notFound, 5, 'key_false').message, /không tra được key của fo_x.*không có mục nào/);
  const absent = scenario({ ads, log: cfg({ S: { fo_x: ID(1) } }, { k1: 'true' }), acceptance: fakeAcceptance({}) });
  assert.match(check(absent, 5, 'present').message, /không tra được key của fo_x/);
  assert.ok(absent.notes.some((n) => /chưa tra được key trong file nghiệm thu/.test(n)));
});

test('rule HF: cặp không xác định được cặp hoặc thuộc case đặc biệt không có kiểm tra hf_order', () => {
  const r = scenario({
    ads: [{ name: 'only_2ID', res: 'fo_only_hf', key: 'k1', id: ID(1) }],
    log: [...cfg({ S: {} }, { k1: 'true' }), loadStart('10:00:01.000', 'Native', ID(1))],
  });
  assert.equal(r.pairs.length, 0);
  assert.equal(check(r, 5, 'hf_order'), undefined);
});

// ------------------------------------------------------------ case đặc biệt (D-075, D-076, D-070)

const MIX_ADS = [
  { name: 'native_full_fo_alt_2ID', res: 'fo_na_mix_after_01_2', id: ID(1) }, // 5
  { name: 'native_ob_full_scr_2ID', res: 'fo_ad_ob_full_hf\nfo_na_mix_after_01', key: 'k_full', id: ID(2) }, // 6
];
const MIX_CFG = (extra = {}, checklist = { fo_na_mix_after_01: ID(2), fo_na_mix_after_01_2: ID(1) }) =>
  cfg({ S: checklist }, { fo_inter_splash: 'true', fo_logic_ad_launcher: 'in_then_na', k_full: 'true', ...extra });

test('case đặc biệt luôn là CẦN XEM, không bao giờ FAIL hay OK, và không áp rule HF', () => {
  // Ad MIX vắng mặt trong log: ad thường sẽ là FAIL "đủ ad", nhưng case đặc biệt chỉ là CẦN XEM
  const r = scenario({ ads: MIX_ADS, log: MIX_CFG() });
  for (const row of [5, 6]) {
    assert.equal(verdict(r, row).status, 'REVIEW', `dòng ${row}`);
    assert.equal(verdict(r, row).special.name, 'MIX');
    assert.equal(check(r, row, 'present').status, 'FAIL', 'kiểm tra chung vẫn được ghi lại để tham khảo');
    assert.equal(check(r, row, 'hf_order'), undefined);
  }
  assert.equal(r.pairs.length, 0);
});

test('MIX: so ID theo D-070, ad tham chiếu native_full_fo_alt hoặc native_ob_full_scr_2ID, khớp hoặc LỆCH', () => {
  const r = scenario({ ads: MIX_ADS, log: MIX_CFG() });
  assert.match(verdict(r, 5).special.idComparisons[0], /fo_na_mix_after_01_2.*native_full_fo_alt_2ID.*dòng 5.*khớp/);
  assert.match(verdict(r, 6).special.idComparisons[0], /fo_na_mix_after_01:.*native_ob_full_scr_2ID.*dòng 6.*khớp/);

  const wrong = scenario({ ads: MIX_ADS, log: MIX_CFG({}, { fo_na_mix_after_01: ID(77), fo_na_mix_after_01_2: ID(1) }) });
  assert.match(verdict(wrong, 6).special.idComparisons[0], /LỆCH/);
  assert.equal(verdict(wrong, 6).status, 'REVIEW', 'lệch vẫn chỉ là CẦN XEM');

  // Có native_full_fo_alt trong kịch bản thì fo_na_mix_after_01 so với nó, không so với native_ob_full_scr_2ID
  const withAlt = scenario({
    ads: [...MIX_ADS, { name: 'native_full_fo_alt', res: 'fo_alt', key: 'k1', id: ID(3) }],
    log: MIX_CFG({}, { fo_na_mix_after_01: ID(3), fo_na_mix_after_01_2: ID(1), fo_alt: ID(3) }),
  });
  assert.match(verdict(withAlt, 6).special.idComparisons[0], /native_full_fo_alt, dòng 7.*khớp/);

  // Không có ad tham chiếu nào
  const none = scenario({
    ads: [{ name: 'x_2ID', res: 'fo_na_mix_after_01', id: ID(1) }],
    log: MIX_CFG({}, { fo_na_mix_after_01: ID(1) }),
  });
  assert.match(none.rows[0].special.idComparisons[0], /không có ad tham chiếu/);
});

test('MIX: key tắt là fo_inter_splash, request khi key = false được ghi vào kiểm tra chung nhưng trạng thái vẫn CẦN XEM', () => {
  const log = [...MIX_CFG({ fo_inter_splash: 'false' }), loadStart('10:00:01.000', 'Native', ID(1))];
  const r = scenario({ ads: MIX_ADS, log });
  const c = check(r, 5, 'key_false');
  assert.equal(c.status, 'FAIL');
  assert.match(c.message, /fo_inter_splash/);
  assert.equal(verdict(r, 5).status, 'REVIEW');
});

test('case đặc biệt: giá trị key liên quan trong log, timeline ID, và ghi chú khi chưa có file nghiệm thu (D-076)', () => {
  const log = [...MIX_CFG(), loadStart('10:00:01.000', 'Native', ID(1)), loadErr('10:00:02.000', 'Native', ID(1))];
  const r = scenario({ ads: MIX_ADS, log });
  const sp = verdict(r, 5).special;
  const val = (k) => sp.keyValues.find((x) => x.key === k);
  assert.equal(val('fo_na_mix_after_01_2').value, ID(1));
  assert.equal(val('fo_na_mix_after_01_2').source, 'checklist');
  assert.equal(val('fo_inter_splash').value, 'true');
  assert.equal(val('fo_inter_splash').source, 'prefs');
  assert.equal(val('fo_logic_ad_launcher').value, 'in_then_na');
  assert.equal(sp.timeline.length, 2);
  assert.equal(sp.acceptance.status, 'no_file');
  assert.match(sp.acceptance.note, /chưa có file nghiệm thu/);
  assert.ok(r.notes.some((n) => /Chưa có file nghiệm thu/.test(n)));
});

test('case đặc biệt: trích nguyên văn từ file nghiệm thu khi có, và báo khi không thấy mục hoặc chưa có tên mục', () => {
  const excerpt = { sheet: 'NT', section: 'Ad native splash', startRow: 54, lines: [{ row: 54, cells: [{ label: 'Key remote', ref: 'D54', text: 'fo_logic_ad_launcher' }] }] };
  const make = (extract) => ({ sheet: 'NT', extract });
  const found = scenario({ ads: MIX_ADS, log: MIX_CFG(), acceptance: make(() => [excerpt]) });
  assert.equal(verdict(found, 5).special.acceptance.status, 'found');
  assert.deepEqual(verdict(found, 5).special.acceptance.excerpts, [excerpt]);

  const calls = [];
  const notFound = scenario({ ads: MIX_ADS, log: MIX_CFG(), acceptance: make((s) => (calls.push(s), [])) });
  assert.equal(verdict(notFound, 5).special.acceptance.status, 'not_found');
  assert.deepEqual([...new Set(calls)], ['Ad native splash'], 'tra đúng tên mục theo special-cases.json');
  assert.ok(!notFound.notes.some((n) => /Chưa có file nghiệm thu/.test(n)));
});

// ------------------------------------------------------------ ad thừa, tổng hợp, ghi chú

test('Thừa: ad id có trong log mà không có trong sheet, kể cả id trống', () => {
  const log = [
    ...ONE_CFG,
    loadStart('10:00:01.000', 'Native', ID(1)),
    loadStart('10:00:02.000', 'Native', ID(50)),
    loadErr('10:00:03.000', 'Native', ID(50)),
    { t: '10:00:04.000', tag: 'FOR_TESTER_LOAD_AD', level: 'D', msg: 'Banner ad:Ad with id(OnlyId(adUnitId=)) starting load ad ...' },
  ];
  const r = scenario({ ads: ONE, log });
  assert.deepEqual(r.extras.map((e) => e.id).sort(), ['', ID(50)].sort());
  const extra = r.extras.find((e) => e.id === ID(50));
  assert.deepEqual([extra.loadStart, extra.loadFail], [1, 1]);
});

test('trạng thái dòng là kết quả xấu nhất của các kiểm tra; NA không ảnh hưởng', () => {
  const log = [...ONE_CFG, loadStart('10:00:01.000', 'Native', ID(1)), loadOk('10:00:02.000', 'Native', ID(1)), show('10:00:03.000', 'NATIVE', ID(1))];
  const r = scenario({ ads: ONE, log });
  assert.equal(verdict(r, 5).status, 'OK');
  assert.ok(verdict(r, 5).checks.every((c) => c.status === 'OK' || c.status === 'NA'));
});

test('ghi chú: ad in-app chưa kiểm được key, ad thiếu key, nhiều lần in CONFIG, log không có CONFIG', () => {
  const log = [
    ...ONE_CFG,
    ...cfg({ S: { fo_a: ID(1) } }, { k1: 'true' }, '10:10:00.000'),
    loadStart('10:00:01.000', 'Native', ID(1)),
  ];
  const r = scenario({ ads: [...ONE, { name: 'inapp_1', id: ID(2) }, { name: 'nokey', res: 'fo_n', id: ID(3) }], log });
  assert.ok(r.notes.some((n) => /1 ad in-app.*console/.test(n)));
  assert.ok(r.notes.some((n) => /1 ad có resource nhưng kịch bản không ghi key/.test(n)));
  assert.ok(r.notes.some((n) => /2 lần in CONFIG/.test(n)));

  const noCfg = scenario({ ads: ONE, log: [loadStart('10:00:01.000', 'Native', ID(1))] });
  assert.ok(noCfg.notes.some((n) => /không có khối CONFIG/.test(n)));
});
