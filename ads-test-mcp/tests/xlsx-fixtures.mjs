// Fixture Excel giả, sinh bằng code (không dùng file mẫu thật của tester).
import ExcelJS from 'exceljs';
import { tmpFile } from './fixtures.mjs';

/**
 * sheets: [{ name, state?: 'visible'|'hidden'|'veryHidden', rows: any[][], merges?: string[] }]
 * `rows` là mảng các hàng, mỗi hàng là mảng giá trị ô theo cột (undefined hoặc null là ô trống).
 */
export async function buildXlsx(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { state: s.state ?? 'visible' });
    s.rows.forEach((cells, i) => {
      const row = ws.getRow(i + 1);
      cells.forEach((v, j) => {
        if (v !== undefined && v !== null) row.getCell(j + 1).value = v;
      });
    });
    for (const m of s.merges ?? []) ws.mergeCells(m);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Ghi workbook ra file tạm, trả đường dẫn tuyệt đối. */
export async function xlsxFile(sheets, name = 'script.xlsx') {
  return tmpFile(await buildXlsx(sheets), name);
}

export const HEADER = [
  'Screen',
  'Ads name',
  'Resource name in the code',
  'Description',
  'Ads type',
  'Ads ID',
  'Remote config in LIB',
];

/**
 * Dựng các hàng của sheet kịch bản theo bố cục của file mẫu:
 *   hàng 1: tiêu đề, hàng 2: trống, hàng 3: header, hàng 4: dòng hướng dẫn mẫu, từ hàng 5: dữ liệu.
 * items: chuỗi (ví dụ "Phase 2") là dòng tiêu đề phase; object là một dòng ad
 * { screen, name, res, desc, type, id, key }.
 */
export function scriptSheetRows(items, { title = 'KỊCH BẢN AD PHASE 1', hint = true } = {}) {
  const rows = [[title], [], HEADER];
  if (hint) {
    rows.push([
      'What is the name of the ad?',
      "What is the admin's name?",
      undefined,
      'Ad shows when?',
      undefined,
      undefined,
      'Remote config to turn ads on/off',
    ]);
  }
  for (const it of items) {
    if (typeof it === 'string') rows.push([it]);
    else rows.push([it.screen, it.name, it.res, it.desc ?? 'mô tả', it.type ?? 'Native', it.id, it.key]);
  }
  return rows;
}

/** Chuyển mảng hai chiều thành SheetData (không qua ExcelJS), để test logic đọc kịch bản. */
export function sheetData(rows2d, name = 'S') {
  const rows = new Map();
  let maxRow = 0;
  rows2d.forEach((cells, i) => {
    const m = new Map();
    cells.forEach((v, j) => {
      if (v === undefined || v === null) return;
      const t = String(v).trim();
      if (t !== '') m.set(j + 1, t);
    });
    if (m.size > 0) {
      rows.set(i + 1, m);
      maxRow = i + 1;
    }
  });
  return { name, rows, maxRow, cellCount: 0 };
}
