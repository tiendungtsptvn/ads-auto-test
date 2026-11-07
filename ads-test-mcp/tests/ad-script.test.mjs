import test from 'node:test';
import assert from 'node:assert/strict';
import { readAdScript } from '../dist/core/ad-script.js';
import { matchSpecialCase } from '../dist/core/special-cases.js';
import { ToolError } from '../dist/core/errors.js';
import { scriptSheetRows, sheetData } from './xlsx-fixtures.mjs';
import { ID } from './fixtures.mjs';

// Bố cục: hàng 1 tiêu đề, 2 trống, 3 header, 4 hướng dẫn mẫu, dữ liệu từ hàng 5.
const run = (items, opts) => readAdScript(sheetData(scriptSheetRows(items, opts)));
const byRow = (s, row) => s.rows.find((r) => r.row === row);
const codes = (s) => s.warnings.map((w) => `${w.row}:${w.code}`);
const ad = (over) => ({ type: 'Native', id: ID(1), ...over });

test('tìm dòng tiêu đề, bỏ qua dòng hướng dẫn mẫu ngay dưới tiêu đề', () => {
  const s = run([ad({ name: 'a', res: 'fo_a', key: 'k_a' })]);
  assert.equal(s.headerRow, 3);
  assert.deepEqual(s.skippedRows, [4]);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].row, 5);
});

test('không có dòng hướng dẫn mẫu thì không bỏ qua dòng dữ liệu nào', () => {
  const s = run([ad({ name: 'a', res: 'fo_a', key: 'k_a' })], { hint: false });
  assert.deepEqual(s.skippedRows, []);
  assert.equal(s.rows[0].row, 4);
});

test('không có header đủ cột Ads name, Ads type, Ads ID thì báo lỗi', () => {
  const bad = sheetData([['KỊCH BẢN'], ['Screen', 'Ads name', 'Description'], ['x', 'y', 'z']]);
  assert.throws(() => readAdScript(bad), (e) => e instanceof ToolError && e.message.startsWith('Lỗi:'));
});

test('mục phase: nhận diện tiêu đề Phase N, phase đầu lấy từ tiêu đề file, phase rỗng có cảnh báo', () => {
  const s = run([
    ad({ screen: 'Splash', name: 'a', res: 'fo_a', key: 'k' }), // 5
    ad({ name: 'b', res: 'fo_b', key: 'k' }), // 6
    'Phase 2', // 7
    ad({ name: 'c', res: 'fo_c', key: 'k' }), // 8
    'Phase 3', // 9
    'Phase 4', // 10
    ad({ name: 'd', res: 'fo_d', key: 'k' }), // 11
  ]);
  assert.deepEqual(
    s.phases.map((p) => [p.name, p.ads]),
    [['Phase 1', 2], ['Phase 2', 1], ['Phase 3', 0], ['Phase 4', 1]],
  );
  assert.deepEqual(s.rows.map((r) => r.phase), ['Phase 1', 'Phase 1', 'Phase 2', 'Phase 4']);
  assert.ok(codes(s).includes('9:empty_phase'));
});

test('tiêu đề file không có chữ Phase thì phase đầu có tên dự phòng', () => {
  const s = run([ad({ name: 'a', res: 'fo_a', key: 'k' })], { title: 'Kịch bản ads' });
  assert.equal(s.phases[0].name, '(đầu sheet)');
});

test('cột Screen điền lại ô trống và reset ở tiêu đề phase', () => {
  const s = run([
    ad({ screen: 'Splash', name: 'a', res: 'fo_a', key: 'k' }),
    ad({ name: 'b', res: 'fo_b', key: 'k' }),
    ad({ screen: 'LFO', name: 'c', res: 'fo_c', key: 'k' }),
    ad({ name: 'd', res: 'fo_d', key: 'k' }),
    'Phase 2',
    ad({ name: 'e', res: 'fo_e', key: 'k' }),
    ad({ screen: 'Home', name: 'f', res: 'fo_f', key: 'k' }),
  ]);
  assert.deepEqual(s.rows.map((r) => r.screen), ['Splash', 'Splash', 'LFO', 'LFO', '', 'Home']);
});

test('tách ô nhiều giá trị: resource ngăn bằng xuống dòng, key ngăn bằng dấu phẩy hoặc xuống dòng', () => {
  const s = run([
    ad({ name: 'a', res: 'fo_a_hf\nfo_a_new', key: 'k1, k2\nk3' }),
    ad({ name: 'b', res: ' fo_b ', key: 'k4' }),
  ]);
  assert.deepEqual(byRow(s, 5).resources, ['fo_a_hf', 'fo_a_new']);
  assert.deepEqual(byRow(s, 5).enableKeys, ['k1', 'k2', 'k3']);
  assert.deepEqual(byRow(s, 6).resources, ['fo_b']);
});

test('D-072: ad không ghi resource thì dùng Ads name cho cả resource lẫn key', () => {
  const s = run([ad({ name: 'banner_all', key: 'v' }), ad({ name: 'reward_ad' })]);
  for (const row of [5, 6]) {
    const r = byRow(s, row);
    assert.deepEqual(r.resources, [r.adsName]);
    assert.equal(r.resourceSource, 'ads_name');
    assert.deepEqual(r.enableKeys, [r.adsName]);
    assert.equal(r.enableKeySource, 'ads_name');
  }
  assert.ok(!codes(s).some((c) => c.endsWith('missing_enable_key')), 'ad in-app không bị cảnh báo thiếu key');
});

test('D-072: không có resource nhưng có tên key thật thì giữ key của sheet', () => {
  const s = run([ad({ name: 'inter_feature', key: 'fo_inter_feature' })]);
  const r = byRow(s, 5);
  assert.deepEqual(r.resources, ['inter_feature']);
  assert.deepEqual(r.enableKeys, ['fo_inter_feature']);
  assert.equal(r.enableKeySource, 'sheet');
});

test('có resource mà thiếu key: cảnh báo missing_enable_key; chỉ có dấu "v": cảnh báo key_marker_only', () => {
  const s = run([
    ad({ name: 'a', res: 'fo_a' }), // 5
    ad({ name: 'b', res: 'fo_b', key: 'v' }), // 6
    ad({ name: 'c', res: 'fo_c', key: 'fo_key_c' }), // 7
  ]);
  assert.deepEqual(byRow(s, 5).enableKeys, []);
  assert.equal(byRow(s, 5).enableKeySource, 'none');
  assert.deepEqual(byRow(s, 6).enableKeys, []);
  assert.deepEqual(
    codes(s).filter((c) => /missing_enable_key|key_marker_only/.test(c)),
    ['5:missing_enable_key', '6:key_marker_only'],
  );
});

test('D-084: Ads name bắt đầu bằng "Note:" là ghi chú, dòng vẫn được kiểm bình thường và không có cảnh báo', () => {
  const s = run([ad({ name: 'Note: nhớ lấy ID medium', res: 'fo_ad_medium', key: 'k' })]);
  const r = byRow(s, 5);
  assert.equal(r.adsName, '');
  assert.equal(r.note, 'nhớ lấy ID medium');
  assert.deepEqual(r.resources, ['fo_ad_medium']);
  assert.equal(r.resourceSource, 'resource');
  assert.deepEqual(codes(s), []);
});

test('dòng không có cả Ads name lẫn Resource name có cảnh báo, dòng trống hoàn toàn bị bỏ qua', () => {
  const rows = scriptSheetRows([{ type: 'Native', id: ID(1) }, ad({ name: 'a', res: 'fo_a', key: 'k', id: ID(2) })]);
  rows.splice(5, 0, []); // chèn một hàng trống giữa hai dòng ad
  const s = readAdScript(sheetData(rows));
  assert.ok(codes(s).includes('5:missing_name'));
  assert.deepEqual(s.rows.map((r) => r.row), [5, 7]);
});

test('D-067: ánh xạ loại ad; loại lạ thì Unknown kèm cảnh báo, thiếu thì cảnh báo', () => {
  const types = ['Interstitial', 'App open', 'app  OPEN', 'Reward', 'Native', 'Banner', 'Splash', undefined];
  const items = types.map((type, i) => ({ name: `n${i}`, res: `fo_${i}`, key: 'k', type, id: ID(i + 1) }));
  // `type: undefined` bị scriptSheetRows thay bằng Native, nên ghi đè sau bằng hàng trống cột type
  const rows = scriptSheetRows(items);
  rows[rows.length - 1][4] = undefined;
  const s = readAdScript(sheetData(rows));
  assert.deepEqual(
    s.rows.map((r) => r.adsType),
    ['Inter', 'Resume', 'Resume', 'Reward', 'Native', 'Banner', 'Unknown', 'Unknown'],
  );
  assert.ok(codes(s).includes('11:unknown_type'));
  assert.ok(codes(s).includes('12:missing_type'));
});

test('Ads ID: thiếu, sai định dạng, trùng đều có cảnh báo; dữ liệu vẫn được giữ', () => {
  const s = run([
    ad({ name: 'a', res: 'fo_a', key: 'k', id: ID(1) }), // 5
    ad({ name: 'b', res: 'fo_b', key: 'k', id: ID(1) }), // 6 trùng
    ad({ name: 'c', res: 'fo_c', key: 'k', id: 'không-phải-id' }), // 7
    ad({ name: 'd', res: 'fo_d', key: 'k', id: undefined }), // 8
  ]);
  assert.ok(codes(s).includes('6:duplicate_id'));
  assert.match(s.warnings.find((w) => w.code === 'duplicate_id').message, /dùng chung với dòng 5/);
  assert.ok(codes(s).includes('7:invalid_id'));
  assert.ok(codes(s).includes('8:missing_id'));
  assert.equal(byRow(s, 7).adsId, 'không-phải-id');
});

test('D-064: nhận diện HF theo Ads name (2ID, không phân biệt hoa thường) hoặc resource (hf)', () => {
  const s = run([
    ad({ name: 'x_2ID', res: 'fo_x' }), // 5: chỉ theo tên
    ad({ name: 'y', res: 'fo_y_hf' }), // 6: chỉ theo resource
    ad({ name: 'z_2id', res: 'fo_z_hf' }), // 7: cả hai
    ad({ name: 'w', res: 'fo_w' }), // 8: không phải HF
    ad({ name: 'v_2ID' }), // 9: resource lấy từ Ads name
  ]);
  assert.deepEqual(s.rows.map((r) => [r.isHF, r.hfReason]), [
    [true, 'ads_name'],
    [true, 'resource'],
    [true, 'both'],
    [false, undefined],
    [true, 'ads_name'],
  ]);
});

test('D-069: ghép cặp HF theo resource name bỏ hậu tố _hf', () => {
  const s = run([
    ad({ name: 'lang1', res: 'fo_ad_native_language_1', key: 'k1' }), // 5
    ad({ name: 'lang1_2ID', res: 'fo_ad_native_language_1_hf', key: 'k2' }), // 6
  ]);
  assert.equal(byRow(s, 6).pairStatus, 'paired');
  assert.equal(byRow(s, 6).pairRow, 5);
  assert.deepEqual(byRow(s, 5).pairedWith, [6]);
});

test('D-074: ghép cặp HF theo resource name bỏ hậu tố _2', () => {
  const s = run([
    ad({ name: 'full2', res: 'fo_nafu_af_02', key: 'k' }), // 5
    ad({ name: 'full2_2ID', res: 'fo_nafu_af_02_2', key: 'k' }), // 6
  ]);
  assert.equal(byRow(s, 6).pairStatus, 'paired');
  assert.equal(byRow(s, 6).pairRow, 5);
});

test('ghép cặp không phân biệt hoa thường, ad thường có thể nằm sau ad HF', () => {
  const s = run([
    ad({ name: 'a_2ID', res: 'FO_AD_A_HF', key: 'k' }), // 5
    ad({ name: 'a', res: 'fo_ad_a', key: 'k' }), // 6
  ]);
  assert.equal(byRow(s, 5).pairRow, 6);
});

test('D-072: ad dùng Ads name thay resource ghép cặp bằng cách bỏ 2ID khỏi Ads name', () => {
  const s = run([
    ad({ name: 'banner_open' }), // 5
    ad({ name: 'banner_open_2id' }), // 6
    ad({ name: 'native_session_2ID' }), // 7: không có ad thường cùng tên
  ]);
  assert.equal(byRow(s, 6).pairStatus, 'paired');
  assert.equal(byRow(s, 6).pairRow, 5);
  assert.equal(byRow(s, 7).pairStatus, 'unpaired');
  assert.ok(codes(s).includes('7:unpaired_hf'));
});

test('khác cụm tên thì không ghép dù Ads name khớp (không đoán): fo_ad_inter_af_04_2 với fo_inter_af_04', () => {
  const s = run([
    ad({ name: 'inter_survey', res: 'fo_inter_af_04', key: 'k' }), // 5
    ad({ name: 'inter_survey_2ID', res: 'fo_ad_inter_af_04_2', key: 'k' }), // 6
  ]);
  assert.equal(byRow(s, 6).pairStatus, 'unpaired');
  assert.equal(byRow(s, 6).pairRow, undefined);
  assert.equal(byRow(s, 5).pairedWith, undefined);
});

test('HF khớp nhiều ad thường thì ambiguous kèm cảnh báo, không chọn bừa', () => {
  const s = run([
    ad({ name: 'a', res: 'fo_a', key: 'k' }), // 5
    ad({ name: 'b', res: 'fo_b', key: 'k' }), // 6
    ad({ name: 'ab_2ID', res: 'fo_a_hf\nfo_b_hf', key: 'k' }), // 7
  ]);
  assert.equal(byRow(s, 7).pairStatus, 'ambiguous');
  assert.equal(byRow(s, 7).pairRow, undefined);
  assert.ok(codes(s).includes('7:ambiguous_pair'));
});

test('ad HF có nhiều resource: ghép được qua một resource, resource không hậu tố bị bỏ qua', () => {
  const s = run([
    ad({ name: 'splash', res: 'fo_ad_inter_splash', key: 'k' }), // 5
    ad({ name: 'splash_2ID', res: 'fo_ad_inter_splash_hf\nfo_ad_inter_splash_new', key: 'k' }), // 6
  ]);
  assert.equal(byRow(s, 6).pairStatus, 'paired');
  assert.equal(byRow(s, 6).pairRow, 5);
});

test('D-075: ad thuộc case đặc biệt không ghép cặp, đánh dấu special_case, kể cả khi có resource HF', () => {
  const s = run([
    ad({ name: 'native_full_fo_alt_2ID', res: 'fo_na_mix_after_01_2' }), // 5
    ad({ name: 'ob_full_2ID', res: 'fo_x_hf\nfo_na_mix_after_01', key: 'k' }), // 6
    ad({ name: 'ob_full', res: 'fo_x', key: 'k' }), // 7: ad thường, không phải case đặc biệt
  ]);
  for (const row of [5, 6]) {
    assert.equal(byRow(s, row).pairStatus, 'special_case');
    assert.equal(byRow(s, row).special.name, 'MIX');
    assert.equal(byRow(s, row).pairRow, undefined);
  }
  assert.equal(byRow(s, 7).special, undefined);
  assert.equal(byRow(s, 7).pairedWith, undefined);
  assert.ok(!codes(s).some((c) => c.endsWith('unpaired_hf')), 'case đặc biệt không bị báo unpaired');
});

test('case đặc biệt nhận diện theo resource, enable key, Ads name; * ở cuối là khớp tiền tố', () => {
  const s = run([
    ad({ name: 'n1', res: 'fo_ad_native_resume', key: 'k' }), // 5: tiền tố fo_ad_native_resume*
    ad({ name: 'n2', res: 'fo_other', key: 'enable_resume' }), // 6: theo key
    ad({ name: 'resume_2ID', res: 'fo_z', key: 'k' }), // 7: theo Ads name
    ad({ name: 'n4', res: 'fo_plain', key: 'k' }), // 8: không phải
  ]);
  assert.deepEqual(s.rows.map((r) => r.special?.name), ['Ad resume', 'Ad resume', 'Ad resume', undefined]);
  assert.equal(byRow(s, 5).special.matchedBy, 'fo_ad_native_resume*');
});

test('matchSpecialCase: danh sách tùy chỉnh, không phân biệt hoa thường, bỏ qua tên rỗng', () => {
  const cases = [{ name: 'X', identifiers: ['abc', 'pre_*'], acceptanceSection: 'Mục X' }];
  assert.equal(matchSpecialCase(['ABC'], cases).name, 'X');
  assert.equal(matchSpecialCase(['PRE_thing'], cases).acceptanceSection, 'Mục X');
  assert.equal(matchSpecialCase(['abcd'], cases), undefined);
  assert.equal(matchSpecialCase(['', 'zzz'], cases), undefined);
});

test('sheet mẫu đầy đủ ghi nhận đủ phase và đếm đúng', () => {
  const s = run([
    ad({ screen: 'Splash', name: 'banner_splash', res: 'fo_ad_banner_splash', type: 'Banner', key: 'fo_banner_splash', id: ID(1) }),
    ad({ name: 'inter_2ID', res: 'fo_ad_inter_splash_hf', type: 'Interstitial', key: 'fo_hf', id: ID(2) }),
    ad({ name: 'inter', res: 'fo_ad_inter_splash', type: 'Interstitial', key: 'fo_i', id: ID(3) }),
    'Phase 2',
    ad({ name: 'native_open_2ID', id: ID(4) }),
    ad({ name: 'native_open', id: ID(5) }),
  ]);
  assert.equal(s.rows.length, 5);
  assert.equal(s.rows.filter((r) => r.isHF).length, 2);
  assert.equal(s.rows.filter((r) => r.pairStatus === 'paired').length, 2);
  assert.deepEqual(s.phases.map((p) => p.ads), [3, 2]);
});

test('D-088, D-090: một resource có hai ID khác nhau, hoặc một key ghi cho hai ad khác nhau thì cảnh báo; dùng chung ID hoặc nhiều key trên một dòng thì không', () => {
  const s = run([
    ad({ name: 'a', res: 'fo_a', key: 'k_a', id: ID(1) }), // 5
    ad({ name: 'b', res: 'fo_a', key: 'k_b', id: ID(2) }), // 6: fo_a đã có ID khác
    ad({ name: 'c', res: 'fo_c', key: 'k_a', id: ID(3) }), // 7: k_a đã ghi cho dòng 5
    ad({ name: 'd', res: 'fo_d', key: 'k_d', id: ID(1) }), // 8: dùng chung ID với dòng 5, hợp lệ
  ]);
  assert.ok(codes(s).includes('6:resource_multi_id'));
  assert.ok(codes(s).includes('7:duplicate_key'));
  assert.ok(!codes(s).some((c) => c.startsWith('8:') && c !== '8:duplicate_id'));
});

test('D-090: một ad có nhiều key (hiển thị ở nhiều vị trí) là hợp lệ, không cảnh báo', () => {
  const s = run([ad({ name: 'a', res: 'fo_a', key: 'k_pos1\nk_pos2', id: ID(1) })]);
  assert.deepEqual(byRow(s, 5).enableKeys, ['k_pos1', 'k_pos2']);
  assert.deepEqual(codes(s), []);
});
