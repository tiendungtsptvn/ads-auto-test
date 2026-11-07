import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogcat } from '../dist/core/logcat.js';
import { analyzeAds } from '../dist/core/ad-events.js';
import {
  makeLog,
  ID,
  loadStart,
  loadOk,
  loadErr,
  nativeSingleErr,
  failureTag,
  show,
} from './fixtures.mjs';

const analyze = (items) => analyzeAds(parseLogcat(makeLog(items)).entries);
const byId = (a, id) => a.ads.find((x) => x.id === id);

test('ánh xạ đủ 5 loại ad cho cả tag LOAD_AD và SHOW_AD (D-067)', () => {
  const a = analyze([
    loadStart('10:00:00.001', 'Interstitial', ID(1)),
    show('10:00:01.001', 'INTERSTITIAL', ID(1)),
    loadStart('10:00:02.001', 'Open', ID(2)),
    show('10:00:03.001', 'APP_OPEN', ID(2)),
    loadStart('10:00:04.001', 'Reward', ID(3)),
    show('10:00:05.001', 'REWARDED', ID(3)),
    loadStart('10:00:06.001', 'Native', ID(4)),
    show('10:00:07.001', 'NATIVE', ID(4)),
    loadStart('10:00:08.001', 'Banner', ID(5)),
    show('10:00:09.001', 'BANNER', ID(5)),
  ]);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => byId(a, ID(n)).adType),
    ['Inter', 'Resume', 'Reward', 'Native', 'Banner'],
  );
  assert.deepEqual(a.unknownTypeLabels, []);
});

test('đếm load, load ok, fail, show cho từng ID và lấy lỗi gần nhất', () => {
  const a = analyze([
    loadStart('10:00:00.000', 'Native', ID(1)),
    loadErr('10:00:01.000', 'Native', ID(1), 'No fill.'),
    loadStart('10:00:10.000', 'Native', ID(1)),
    loadOk('10:00:11.000', 'Native', ID(1)),
    show('10:00:12.000', 'NATIVE', ID(1)),
  ]);
  const s = byId(a, ID(1));
  assert.equal(s.loadStart, 2);
  assert.equal(s.loadOk, 1);
  assert.equal(s.loadFail, 1);
  assert.equal(s.show, 1);
  assert.equal(s.lastError, 'No fill.');
  assert.equal(s.firstTime, '2026-10-24 10:00:00.000');
  assert.equal(s.lastTime, '2026-10-24 10:00:12.000');
});

test('một lần load fail in nhiều dòng chỉ tính một lần (LOAD_AD, LOAD_FAILURE, native single)', () => {
  const a = analyze([
    loadStart('10:00:00.000', 'Interstitial', ID(1)),
    loadErr('10:00:01.000', 'Interstitial', ID(1)),
    failureTag('10:00:01.003', 'INTERSTITIAL', ID(1)),
    loadStart('10:00:02.000', 'Native', ID(2)),
    loadErr('10:00:03.000', 'Native', ID(2)),
    nativeSingleErr('10:00:03.010', ID(2)),
  ]);
  assert.equal(byId(a, ID(1)).loadFail, 1);
  assert.equal(byId(a, ID(2)).loadFail, 1);
  assert.equal(a.events.filter((e) => e.kind === 'load_fail').length, 2);
});

test('hai lần fail thật của cùng ID, cùng nguồn, vẫn là hai lần dù cách nhau chưa tới 2 giây', () => {
  const a = analyze([
    failureTag('10:00:00.000', 'INTERSTITIAL', ID(1)),
    failureTag('10:00:01.200', 'INTERSTITIAL', ID(1)),
  ]);
  assert.equal(byId(a, ID(1)).loadFail, 2);
});

test('fail của hai nguồn khác nhau nhưng cách xa nhau thì là hai lần', () => {
  const a = analyze([
    loadErr('10:00:00.000', 'Interstitial', ID(1)),
    failureTag('10:00:30.000', 'INTERSTITIAL', ID(1)),
  ]);
  assert.equal(byId(a, ID(1)).loadFail, 2);
});

test('rút gọn lỗi: bỏ FailToLoad(...) và link hướng dẫn', () => {
  const a = analyze([
    loadErr('10:00:00.000', 'Native', ID(1), 'No ads meet eCPM floor. <https://support.example.com/x#8>'),
  ]);
  assert.equal(byId(a, ID(1)).lastError, 'No ads meet eCPM floor.');
});

test('ad id trống được gom vào id rỗng, không lẫn với ad khác', () => {
  const a = analyze([
    {
      t: '10:00:00.000',
      tag: 'FOR_TESTER_LOAD_AD',
      level: 'D',
      msg: 'Banner ad:Ad with id(OnlyId(adUnitId=)) starting load ad ...',
    },
    loadStart('10:00:01.000', 'Banner', ID(1)),
  ]);
  assert.equal(a.ads.length, 2);
  assert.equal(byId(a, '').adType, 'Banner');
  assert.equal(byId(a, '').loadStart, 1);
});

test('nhãn loại ad lạ được báo lại và loại là Unknown, không đoán', () => {
  const a = analyze([
    loadStart('10:00:00.000', 'Splash', ID(1)),
    show('10:00:01.000', 'MYSTERY', ID(2)),
  ]);
  assert.equal(byId(a, ID(1)).adType, 'Unknown');
  assert.equal(byId(a, ID(2)).adType, 'Unknown');
  assert.deepEqual(a.unknownTypeLabels, ['MYSTERY', 'Splash']);
});

test('tag khác ad event bị bỏ qua', () => {
  const a = analyze([
    { t: '10:00:00.000', tag: 'FOR_TESTER_PRELOAD', level: 'W', msg: `KEY[x] Native loaded with result: Loaded(adUnitId:${ID(9)})` },
    { t: '10:00:00.100', tag: 'OtherTag', msg: `NATIVE - ${ID(9)}` },
  ]);
  assert.equal(a.ads.length, 0);
});

test('thứ tự ad theo lần xuất hiện đầu tiên, events giữ thứ tự log', () => {
  const a = analyze([
    loadStart('10:00:00.000', 'Native', ID(2)),
    loadStart('10:00:01.000', 'Native', ID(1)),
    show('10:00:02.000', 'NATIVE', ID(2)),
  ]);
  assert.deepEqual(a.ads.map((x) => x.id), [ID(2), ID(1)]);
  assert.deepEqual(a.events.map((e) => e.kind), ['load_start', 'load_start', 'show']);
});
