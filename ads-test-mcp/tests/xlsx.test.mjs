import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { XlsxWorkbook, colIndex, colLabel, normalizeCellText, valueToText } from '../dist/core/xlsx.js';
import { ZipArchive } from '../dist/core/zip.js';
import { ToolError } from '../dist/core/errors.js';
import { tmpFile } from './fixtures.mjs';
import { buildXlsx, xlsxFile } from './xlsx-fixtures.mjs';

const cell = (sheet, row, col) => sheet.rows.get(row)?.get(col);

// ------------------------------------------------------------ đọc dữ liệu

test('đọc giá trị ô, chuẩn hóa ký tự vô hình, xuống dòng, khoảng trắng', async () => {
  const buf = await buildXlsx([
    {
      name: 'S',
      rows: [
        ['  có khoảng trắng  ', 'ẩn​​ ký tự', 'dòng 1\r\ndòng 2', 'nbsp giữa', 'x'],
        [undefined, undefined, 'C2'],
      ],
    },
  ]);
  const wb = await XlsxWorkbook.fromBuffer(buf);
  const s = wb.readSheet('S');
  assert.equal(cell(s, 1, 1), 'có khoảng trắng');
  assert.equal(cell(s, 1, 2), 'ẩn ký tự');
  assert.equal(cell(s, 1, 3), 'dòng 1\ndòng 2');
  assert.equal(cell(s, 1, 4), 'nbsp giữa');
  assert.equal(cell(s, 2, 3), 'C2');
  assert.equal(s.cellCount, 6);
  assert.equal(s.maxRow, 2);
});

test('ô rỗng không có trong kết quả; sheet chỉ có ô khoảng trắng coi như trống', async () => {
  const buf = await buildXlsx([{ name: 'S', rows: [['a'], ['   '], [], ['b']] }]);
  const s = (await XlsxWorkbook.fromBuffer(buf)).readSheet('S');
  assert.deepEqual([...s.rows.keys()], [1, 4]);
});

test('rich text, công thức (lấy kết quả đã lưu), số, boolean đều đọc ra chuỗi', async () => {
  const buf = await buildXlsx([
    {
      name: 'S',
      rows: [
        [
          { richText: [{ text: 'Xin ' }, { text: 'chào', font: { bold: true } }] },
          { formula: 'A1&"!"', result: 'kết quả' },
          42,
          true,
          { text: 'link', hyperlink: 'https://example.com' },
          { text: { richText: [{ text: 'Chữ ' }, { text: 'rich', font: { bold: true } }] }, hyperlink: 'https://example.com' },
          { formula: 'NA()', result: { error: '#N/A' } },
          new Date(Date.UTC(2026, 9, 24, 13, 38, 47)),
        ],
      ],
    },
  ]);
  const s = (await XlsxWorkbook.fromBuffer(buf)).readSheet('S');
  assert.equal(cell(s, 1, 1), 'Xin chào');
  assert.equal(cell(s, 1, 2), 'kết quả');
  assert.equal(cell(s, 1, 3), '42');
  assert.ok(['TRUE', 'true', '1'].includes(cell(s, 1, 4)), `boolean đọc ra: ${cell(s, 1, 4)}`);
  assert.equal(cell(s, 1, 5), 'link');
  assert.equal(cell(s, 1, 6), 'Chữ rich', 'hyperlink có chữ rich text không được thành [object Object]');
  assert.equal(cell(s, 1, 7), undefined, 'lỗi công thức coi như ô trống');
  assert.equal(cell(s, 1, 8), '2026-10-24T13:38:47.000Z');
});

test('valueToText: mọi dạng giá trị đều ra chuỗi, không bao giờ là [object Object]', () => {
  assert.equal(valueToText(null), '');
  assert.equal(valueToText(undefined), '');
  assert.equal(valueToText(0), '0');
  assert.equal(valueToText(false), 'FALSE');
  assert.equal(valueToText({ sharedFormula: 'A1', result: 12 }), '12');
  assert.equal(valueToText({ error: '#REF!' }), '');
  assert.equal(valueToText({ richText: [{ text: 'a' }, { text: 'b' }] }), 'ab');
  assert.equal(valueToText({ text: { richText: [{ text: 'x' }] }, hyperlink: 'u' }), 'x');
  assert.equal(valueToText({ lạ: 1 }), '');
  assert.equal(valueToText(new Date('invalid')), '');
});

test('vùng gộp: chỉ ô chính có giá trị, ô con bị bỏ để không nhân bản giá trị', async () => {
  const buf = await buildXlsx([
    {
      name: 'S',
      rows: [['Tiêu đề gộp ngang'], ['LFO', 'x'], [undefined, 'y']],
      merges: ['A1:C1', 'A2:A3'],
    },
  ]);
  const s = (await XlsxWorkbook.fromBuffer(buf)).readSheet('S');
  assert.equal(cell(s, 1, 1), 'Tiêu đề gộp ngang');
  assert.equal(cell(s, 1, 2), undefined);
  assert.equal(cell(s, 1, 3), undefined);
  assert.equal(cell(s, 2, 1), 'LFO');
  assert.equal(cell(s, 3, 1), undefined);
  assert.equal(cell(s, 3, 2), 'y');
});

test('danh sách sheet: tên, trạng thái ẩn; đọc theo tên chính xác', async () => {
  const buf = await buildXlsx([
    { name: 'Hiện', rows: [['a']] },
    { name: 'Ẩn', state: 'hidden', rows: [['b']] },
    { name: 'Rất ẩn', state: 'veryHidden', rows: [['c']] },
  ]);
  const wb = await XlsxWorkbook.fromBuffer(buf);
  assert.deepEqual(wb.sheets, [
    { name: 'Hiện', state: 'visible' },
    { name: 'Ẩn', state: 'hidden' },
    { name: 'Rất ẩn', state: 'veryHidden' },
  ]);
  assert.equal(cell(wb.readSheet('Ẩn'), 1, 1), 'b');
  assert.throws(() => wb.readSheet('hiện'), ToolError); // phân biệt hoa thường
  assert.throws(() => wb.readSheet('Không có'), (e) => e instanceof ToolError && e.message.startsWith('Lỗi:'));
});

test('.xlsm: mở được, không chạy macro (chỉ đọc giá trị ô)', async () => {
  const xlsx = await buildXlsx([{ name: 'S', rows: [['giá trị']] }]);
  const zip = await JSZip.loadAsync(xlsx);
  const ct = await zip.file('[Content_Types].xml').async('string');
  zip.file(
    '[Content_Types].xml',
    ct.replace(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
    ),
  );
  zip.file('xl/vbaProject.bin', Buffer.from('không phải macro thật'));
  const file = tmpFile(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'macro.xlsm');
  const wb = await XlsxWorkbook.open(file);
  assert.equal(cell(wb.readSheet('S'), 1, 1), 'giá trị');
});

// ------------------------------------------------------------ từ chối đầu vào xấu

test('open: đường dẫn phải tuyệt đối, tồn tại, là file, đuôi .xlsx hoặc .xlsm', async () => {
  const good = await xlsxFile([{ name: 'S', rows: [['a']] }]);
  await assert.rejects(XlsxWorkbook.open('relative.xlsx'), ToolError);
  await assert.rejects(XlsxWorkbook.open('/khong/ton/tai.xlsx'), ToolError);
  await assert.rejects(XlsxWorkbook.open(path.dirname(good)), /file thường/);
  const wrongExt = path.join(path.dirname(good), 'copy.txt');
  fs.copyFileSync(good, wrongExt);
  await assert.rejects(XlsxWorkbook.open(wrongExt), /\.xlsx hoặc \.xlsm/);
  await assert.rejects(XlsxWorkbook.open(undefined), ToolError);
});

test('từ chối file có mật khẩu hoặc .xls cũ (OLE), file không phải xlsx, file rỗng, file cụt', async () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
  await assert.rejects(XlsxWorkbook.fromBuffer(ole), /mật khẩu/);
  await assert.rejects(XlsxWorkbook.fromBuffer(Buffer.from('chỉ là văn bản thường')), /không phải xlsx/);
  await assert.rejects(XlsxWorkbook.fromBuffer(Buffer.alloc(0)), ToolError);
  const good = await buildXlsx([{ name: 'S', rows: [['a']] }]);
  await assert.rejects(XlsxWorkbook.fromBuffer(good.subarray(0, Math.floor(good.length / 2))), ToolError);
});

test('zip hợp lệ nhưng không phải xlsx (thiếu workbook) bị từ chối', async () => {
  const zip = new JSZip();
  zip.file('hello.txt', 'xin chào');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(XlsxWorkbook.fromBuffer(buf), /thiếu cấu trúc workbook/);
});

test('thông báo lỗi khi đọc hỏng không lộ nội dung bên trong', async () => {
  const good = await buildXlsx([{ name: 'S', rows: [['BI-MAT-XYZ']] }]);
  const zip = await JSZip.loadAsync(good);
  zip.file('xl/workbook.xml', 'đây không phải xml hợp lệ BI-MAT-XYZ');
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(XlsxWorkbook.fromBuffer(buf), (e) => e instanceof ToolError && !e.message.includes('BI-MAT-XYZ'));
});

// ------------------------------------------------------------ giới hạn zip

async function zipOf(files) {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('zip: giới hạn số thành phần, kích thước một thành phần và tổng kích thước sau giải nén', async () => {
  const many = await zipOf({ a: '1', b: '2', c: '3' });
  assert.throws(() => ZipArchive.open(many, { maxEntries: 2, maxEntryBytes: 1e6, maxTotalBytes: 1e6 }), /quá nhiều/);

  const big = await zipOf({ 'big.xml': Buffer.alloc(2 * 1024 * 1024, 0x61) });
  assert.throws(() => ZipArchive.open(big, { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 1e9 }), /quá lớn/);

  const two = await zipOf({ 'a.xml': Buffer.alloc(600_000, 0x61), 'b.xml': Buffer.alloc(600_000, 0x62) });
  assert.throws(() => ZipArchive.open(two, { maxEntries: 10, maxEntryBytes: 1e6, maxTotalBytes: 1_000_000 }), /quá lớn/);
});

test('zip: khai báo kích thước nhỏ hơn thực tế (zip bomb khai gian) bị phát hiện khi giải nén', async () => {
  const buf = await zipOf({ 'a.xml': Buffer.alloc(100_000, 0x61) });
  // Sửa kích thước giải nén khai báo trong central directory xuống 10 byte
  const p = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(p >= 0);
  buf.writeUInt32LE(10, p + 24);
  const zip = ZipArchive.open(buf);
  assert.throws(() => zip.read('a.xml'), ToolError);
});

test('xlsx có thành phần khai gian kích thước bị từ chối trước khi đưa cho ExcelJS', async () => {
  const x = await buildXlsx([{ name: 'S', rows: [['a']] }]);
  const q = x.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  x.writeUInt32LE(1, q + 24);
  // Thông báo riêng của bước kiểm tra trước; nếu bước này bị bỏ thì chỉ còn lỗi chung của ExcelJS
  await assert.rejects(XlsxWorkbook.fromBuffer(x), /vượt khai báo/);
});

test('zip: thành phần mã hóa và thành phần trùng tên bị từ chối', async () => {
  const buf = await zipOf({ 'a.xml': 'abc' });
  const enc = Buffer.from(buf);
  const p = enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  enc.writeUInt16LE(enc.readUInt16LE(p + 8) | 1, p + 8);
  assert.throws(() => ZipArchive.open(enc), /mật khẩu|mã hóa/);

  const dup = await zipOf({ 'a.xml': 'abc', 'b.xml': 'def' });
  const nameB = dup.indexOf(Buffer.from('b.xml'), dup.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
  dup.write('a.xml', nameB); // tên thứ hai trong central directory thành a.xml
  assert.throws(() => ZipArchive.open(dup), /trùng tên/);
});

// ------------------------------------------------------------ tiện ích

test('colIndex và colLabel là phép nghịch đảo của nhau', () => {
  assert.equal(colIndex('A'), 1);
  assert.equal(colIndex('Z'), 26);
  assert.equal(colIndex('AA'), 27);
  assert.equal(colIndex('az'), 52);
  assert.ok(Number.isNaN(colIndex('A1')));
  for (const n of [1, 26, 27, 52, 53, 702, 703, 16384]) assert.equal(colIndex(colLabel(n)), n);
});

test('normalizeCellText', () => {
  assert.equal(normalizeCellText('﻿  a​b \r\n c\r d  '), 'ab \n c\n d');
});

test('ExcelJS là dependency trực tiếp và đọc được workbook do chính nó ghi', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('S').getCell('A1').value = 'ok';
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  assert.equal(cell((await XlsxWorkbook.fromBuffer(buf)).readSheet('S'), 1, 1), 'ok');
});
