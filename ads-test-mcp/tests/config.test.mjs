import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogcat } from '../dist/core/logcat.js';
import { extractConfig } from '../dist/core/config.js';
import { maskSecrets } from '../dist/core/mask.js';
import { makeLog, configBlock, ID } from './fixtures.mjs';

const PREFS = {
  enable_resume: 'true',
  fo_ad_af_04: 'true',
  fo_ad_af_04_2ID: 'false',
  fo_countdown: '5',
  fo_default_language_order: '[es, en, vi]',
  adjust_api_token: 'SECRET-VALUE-123',
};
const CHECKLIST = {
  'AD_UNITS - SPLASH': {
    fo_ad_inter_splash_hf: ID(1),
    fo_ad_inter_splash: ID(2),
    fo_ad_banner_splash_hf: '',
  },
  BOOLEANS: { fo_onboarding_single: 'false' },
};

const cfgOf = (items) => extractConfig(parseLogcat(makeLog(items)).entries);

test('đọc khối Remote FO Prefs nhiều dòng, giữ giá trị chứa dấu hai chấm hoặc ngoặc', () => {
  const c = cfgOf(configBlock('10:00:00.000', { prefs: PREFS, checklist: CHECKLIST }));
  assert.equal(c.snapshots.length, 1);
  const p = c.snapshots[0].prefs;
  assert.equal(p.enable_resume, 'true');
  assert.equal(p.fo_ad_af_04_2ID, 'false');
  assert.equal(p.fo_default_language_order, '[es, en, vi]');
  assert.equal(Object.keys(p).length, Object.keys(PREFS).length);
});

test('che giá trị của key trông giống secret ngay khi đọc', () => {
  const c = cfgOf(configBlock('10:00:00.000', { prefs: PREFS }));
  assert.equal(c.snapshots[0].prefs.adjust_api_token, '***');
  assert.ok(!JSON.stringify(c).includes('SECRET-VALUE-123'));
});

test('đọc FO CONFIG CHECKLIST: section, key, ad id, (empty) thành chuỗi rỗng', () => {
  const s = cfgOf(configBlock('10:00:00.000', { prefs: PREFS, checklist: CHECKLIST })).snapshots[0];
  assert.equal(s.checklist.fo_ad_inter_splash_hf, ID(1));
  assert.equal(s.checklist.fo_ad_inter_splash, ID(2));
  assert.equal(s.checklist.fo_ad_banner_splash_hf, '');
  assert.equal(s.checklist.fo_onboarding_single, 'false');
  assert.equal(s.checklistSection.fo_ad_inter_splash, 'AD_UNITS - SPLASH');
  assert.equal(s.checklistSection.fo_onboarding_single, 'BOOLEANS');
});

test('checklist kết thúc ở dòng kẻ cuối, dòng CONFIG sau đó không lọt vào checklist', () => {
  const items = [
    ...configBlock('10:00:00.000', { prefs: PREFS, checklist: CHECKLIST }),
    { t: '10:00:01.000', tag: 'FOR_TESTER_CONFIG', msg: 'Target SDK: 36' },
    { t: '10:00:01.001', tag: 'FOR_TESTER_CONFIG', msg: 'FB AdImpression threshold (USD): 0.03' },
  ];
  const s = cfgOf(items).snapshots[0];
  assert.equal(s.checklist['Target'], undefined);
  assert.equal(Object.keys(s.checklist).length, 4);
});

test('đọc version lib: FIRST OPEN và các lib khác', () => {
  const items = [
    ...configBlock('10:00:00.000', { version: '4.20.0', prefs: PREFS }),
    { t: '10:00:02.000', tag: 'FOR_TESTER_CONFIG', msg: 'Version Lib Ads: 9.3.0' },
    { t: '10:00:02.001', tag: 'FOR_TESTER_CONFIG', msg: 'Version Lib Adjust: 5.8.0' },
  ];
  const c = cfgOf(items);
  assert.equal(c.libVersion, '4.20.0');
  assert.deepEqual(c.libVersions, { Ads: '9.3.0', Adjust: '5.8.0' });
});

test('app khởi động lại: mỗi lần in CONFIG là một snapshot riêng', () => {
  const items = [
    ...configBlock('10:00:00.000', { prefs: { a: '1', b: 'x' }, checklist: { S: { k: ID(1) } } }),
    ...configBlock('10:05:00.000', { prefs: { a: '2', b: 'x' }, checklist: { S: { k: ID(2) } } }),
  ];
  const c = cfgOf(items);
  assert.equal(c.snapshots.length, 2);
  assert.equal(c.snapshots[0].prefs.a, '1');
  assert.equal(c.snapshots[1].prefs.a, '2');
  assert.equal(c.snapshots[1].checklist.k, ID(2));
});

test('log không có khối CONFIG thì không có snapshot', () => {
  const c = cfgOf([{ t: '10:00:00.000', tag: 'FOR_TESTER_FO', msg: 'x' }]);
  assert.equal(c.snapshots.length, 0);
  assert.equal(c.libVersion, undefined);
});

test('maskSecrets che token, password, api key trong text tự do', () => {
  assert.equal(maskSecrets('Adjust config token: abc123xyz'), 'Adjust config token: ***');
  assert.equal(maskSecrets('password=hunter2 ok'), 'password=*** ok');
  assert.equal(maskSecrets('api_key: AIzaSyFAKE'), 'api_key: ***');
  assert.equal(maskSecrets('fo_countdown: 5'), 'fo_countdown: 5');
});
