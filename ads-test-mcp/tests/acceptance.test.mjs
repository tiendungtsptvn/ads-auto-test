import test from 'node:test';
import assert from 'node:assert/strict';
import { readAcceptance, keyFromCell } from '../dist/core/acceptance.js';
import { ToolError } from '../dist/core/errors.js';
import { xlsxFile } from './xlsx-fixtures.mjs';

const HDR = [undefined, undefined, 'Tên ad', 'Key remote', 'Tiền điều kiện', 'Mô tả', 'Mô tả ID', 'Ví dụ log'];

/** Sheet nghiệm thu giả theo bố cục của file mẫu: tiêu đề ở hàng 4, cột C là tên ad. */
const sheetRows = (extra = []) => [
  ['Yêu cầu bắt buộc'],
  [],
  [],
  HDR,
  [undefined, undefined, 'Banner Splash', 'fo_banner_splash: tắt ad', undefined, undefined, 'Check ID banner', 'https://example.com/1'],
  [],
  [undefined, undefined, 'Ad resume\n(Tester test nếu spec yêu cầu)', 'enable_resume\nresume_2ID', undefined, undefined, 'Lấy các ID ad:\n- resume', 'https://example.com/2'],
  [undefined, undefined, undefined, undefined, '1. enable_resume = true', undefined, 'Trạng thái: TRUE'],
  [undefined, undefined, undefined, undefined, '1. enable_resume = false', undefined, 'Tắt ad resume'],
  [undefined, undefined, 'Native Preparing', 'fo_native_full_preparing_data', '1. = TRUE', 'Bật ad', 'Show sau OB3'],
  [undefined, undefined, 'ad RESUME', 'enable_resume', undefined, undefined, 'Khối thứ hai cùng tên (không phân biệt hoa thường)'],
  ...extra,
];

const open = async (rows, sheet) => readAcceptance(await xlsxFile([{ name: 'Nghiệm thu', rows }]), sheet);

test('extract: lấy cả khối từ dòng có tên mục đến dòng có tên mục kế tiếp, nguyên văn và kèm vị trí ô', async () => {
  const acc = await open(sheetRows());
  const [ex] = acc.extract('Native Preparing');
  assert.equal(ex.sheet, 'Nghiệm thu');
  assert.equal(ex.section, 'Native Preparing');
  assert.equal(ex.startRow, 10);
  assert.equal(ex.lines.length, 1);
  assert.deepEqual(
    ex.lines[0].cells.map((c) => [c.label, c.ref, c.text]),
    [
      ['Tên ad', 'C10', 'Native Preparing'],
      ['Key remote', 'D10', 'fo_native_full_preparing_data'],
      ['Tiền điều kiện', 'E10', '1. = TRUE'],
      ['Mô tả', 'F10', 'Bật ad'],
      ['Mô tả ID', 'G10', 'Show sau OB3'],
    ],
  );
});

test('extract: khối nhiều dòng gồm các dòng cột Tên ad trống; bỏ cột Ví dụ log; giữ nguyên xuống dòng', async () => {
  const acc = await open(sheetRows());
  const [first] = acc.extract('Ad resume');
  assert.equal(first.startRow, 7);
  assert.deepEqual(first.lines.map((l) => l.row), [7, 8, 9]);
  const all = first.lines.flatMap((l) => l.cells);
  assert.ok(!all.some((c) => /Ví dụ log/.test(c.label)), 'không lấy cột link ảnh');
  assert.ok(!all.some((c) => /example\.com/.test(c.text)));
  assert.equal(all.find((c) => c.ref === 'D7').text, 'enable_resume\nresume_2ID');
  assert.equal(all.find((c) => c.ref === 'G9').text, 'Tắt ad resume');
});

test('extract: tên mục là dòng đầu của ô Tên ad, không phân biệt hoa thường; cùng tên xuất hiện nhiều lần thì lấy mọi khối', async () => {
  const acc = await open(sheetRows());
  const blocks = acc.extract('ad resume');
  assert.deepEqual(blocks.map((b) => b.startRow), [7, 11]);
  assert.equal(blocks[1].section, 'ad RESUME');
  assert.deepEqual(acc.extract('Không có mục này'), []);
  assert.deepEqual(acc.extract('Banner'), [], 'phải khớp trọn tên mục, không khớp một phần');
});

test('extract: ô dài bị cắt khoảng 700 ký tự', async () => {
  const acc = await open(sheetRows([[undefined, undefined, 'Mục dài', undefined, undefined, undefined, 'x'.repeat(2000)]]));
  const cell = acc.extract('Mục dài')[0].lines[0].cells.find((c) => c.label === 'Mô tả ID');
  assert.ok(cell.text.length <= 703);
  assert.ok(cell.text.endsWith('...'));
});

test('chọn sheet: mặc định là sheet hiện duy nhất, bỏ qua sheet ẩn', async () => {
  const file = await xlsxFile([
    { name: 'Bản cũ', state: 'hidden', rows: sheetRows() },
    { name: 'Hiện tại', rows: sheetRows() },
  ]);
  const acc = await readAcceptance(file, undefined);
  assert.equal(acc.sheet, 'Hiện tại');
});

test('chọn sheet: nhiều sheet hiện mà thiếu tham số thì lỗi kèm danh sách; sheet lạ thì lỗi; chọn rõ sheet ẩn được', async () => {
  const file = await xlsxFile([
    { name: 'A', rows: sheetRows() },
    { name: 'B', rows: sheetRows() },
    { name: 'Ẩn', state: 'hidden', rows: sheetRows() },
  ]);
  await assert.rejects(readAcceptance(file, undefined), (e) => e instanceof ToolError && /acceptance_sheet/.test(e.message) && /"A"/.test(e.message) && /"Ẩn" \(ẩn\)/.test(e.message));
  await assert.rejects(readAcceptance(file, 'Z'), /Các sheet/);
  assert.equal((await readAcceptance(file, 'Ẩn')).sheet, 'Ẩn');
  assert.equal((await readAcceptance(file, 'B')).sheet, 'B');
});

test('sheet không có dòng tiêu đề "Tên ad" thì báo lỗi rõ ràng', async () => {
  await assert.rejects(open([['a', 'b'], ['c', 'd']]), (e) => e instanceof ToolError && /Tên ad/.test(e.message));
});

test('file không phải xlsx hoặc đường dẫn sai bị từ chối', async () => {
  await assert.rejects(readAcceptance('tương-đối.xlsx', undefined), ToolError);
  await assert.rejects(readAcceptance(undefined, undefined), ToolError);
});

// ------------------------------------------------------------ tra key remote (D-083, D-089)

test('keyFromCell: ghi chú "tắt ad"/"tắt 2f", cặp X và X_2ID, còn lại không kết luận', () => {
  const marked = 'fo_banner_splash : tắt ad\nfo_hf_banner_splash: tắt 2f';
  assert.deepEqual(keyFromCell(marked, false), { key: 'fo_banner_splash' });
  assert.deepEqual(keyFromCell(marked, true), { key: 'fo_hf_banner_splash' });
  assert.deepEqual(keyFromCell('fo_na_fu_af_02\nfo_na_fu_af_02_2ID', true), { key: 'fo_na_fu_af_02_2ID' });
  assert.deepEqual(keyFromCell('fo_na_fu_af_02\nfo_na_fu_af_02_2ID', false), { key: 'fo_na_fu_af_02' });
  assert.match(keyFromCell('fo_logic_ad_launcher\nlogic_na_fu_alt', false).reason, /không có cặp key/);
  assert.match(keyFromCell('a\na_2ID\nb\nb_2ID', true).reason, /nhiều cặp/);
  assert.match(keyFromCell('fo_only: tắt ad', true).reason, /không có key ghi cho ad HF/);
});

const keyRows = () => [
  [],
  HDR,
  [undefined, undefined, 'Banner Splash', 'fo_banner_splash : tắt ad\nfo_hf_banner_splash: tắt 2f', undefined, undefined, 'Check các thông tin ad:\n- fo_ad_banner_splash_hf: Lấy ID ad banner_splash_hf\n- fo_ad_banner_splash: Lấy ID ad banner_splash thường'],
  [undefined, undefined, 'Ad sau LFO2', 'fo_na_fu_af_02\nfo_na_fu_af_02_2ID', undefined, undefined, '- fo_nafu_af_02_2: Lấy ID ad native_full_fo_2_2ID\n- fo_nafu_af_02: Lấy ID ad native_full_fo_2 thường'],
  [undefined, undefined, undefined, 'fo_ui_na_fu_af_02', '1. fo_na_fu_af_02 = true', 'Check layout ad', 'UI'],
  [undefined, undefined, 'Ad native splash', 'fo_logic_ad_launcher\nlogic_na_fu_alt', undefined, undefined, '- fo_na_mix_after_01: Lấy ID ad native_full_fo_alt'],
  [undefined, undefined, 'Native Uninstall', 'fo_native_reason_uninstall: tắt ad\nfo_native_reason_uninstall_2ID: tắt 2f', undefined, undefined, '- fo_native_reason_uninstall_2ID: Lấy ID ad native_uninstall_2ID'],
  [undefined, undefined, 'Khối trùng', 'k_dup', undefined, undefined, '- fo_ad_banner_splash: nhắc lại'],
];

test('findKey: theo resource (khớp nguyên từ), lấy ô Key remote cùng dòng, kèm mục và ô', async () => {
  const acc = await open(keyRows());
  const lfo = acc.findKey({ resource: 'fo_nafu_af_02_2', adsName: 'native_full_fo_2_2ID', isHF: true });
  assert.deepEqual(lfo, { status: 'found', key: 'fo_na_fu_af_02_2ID', by: 'resource', needle: 'fo_nafu_af_02_2', section: 'Ad sau LFO2', ref: 'D4' });
  const normal = acc.findKey({ resource: 'fo_nafu_af_02', adsName: 'native_full_fo_2', isHF: false });
  assert.equal(normal.key, 'fo_na_fu_af_02', '"fo_nafu_af_02" không bị nhầm là một phần của "fo_nafu_af_02_2"');
  const hf = acc.findKey({ resource: 'fo_ad_banner_splash_hf', adsName: 'banner_splash_2ID', isHF: true });
  assert.equal(hf.key, 'fo_hf_banner_splash');
});

test('findKey: không có resource thì tra theo Ads name; không thấy, nhiều mục hoặc mục không rõ key thì trả lý do', async () => {
  const acc = await open(keyRows());
  const byName = acc.findKey({ resource: 'fo_ad_native_reason_uninstall_hf', adsName: 'native_uninstall_2ID', isHF: true });
  assert.equal(byName.status, 'found');
  assert.equal(byName.by, 'ads_name');
  assert.equal(byName.key, 'fo_native_reason_uninstall_2ID');

  const none = acc.findKey({ resource: 'fo_ad_survey', adsName: 'native_survey', isHF: false });
  assert.equal(none.status, 'not_found');
  assert.match(none.reason, /fo_ad_survey.*native_survey/);

  const dup = acc.findKey({ resource: 'fo_ad_banner_splash', adsName: '', isHF: false });
  assert.equal(dup.status, 'ambiguous');
  assert.match(dup.reason, /2 mục/);

  const unclear = acc.findKey({ resource: 'fo_na_mix_after_01', adsName: '', isHF: false });
  assert.equal(unclear.status, 'unclear');
  assert.match(unclear.reason, /Ad native splash.*D6/);
});
