import { type AdType } from './ad-events.js';
import { ToolError } from './errors.js';
import { matchSpecialCase, type SpecialMatch } from './special-cases.js';
import { type SheetData } from './xlsx.js';

/**
 * Chuẩn hóa một sheet kịch bản ads (M2). Rule lấy từ các quyết định D-064, D-067, D-069, D-071 đến D-075.
 * Gặp tình huống rule chưa nói tới thì không đoán: giữ nguyên dữ liệu và thêm cảnh báo.
 */

export type PairStatus = 'paired' | 'special_case' | 'unpaired' | 'ambiguous';

export interface AdScriptRow {
  /** Số dòng trong sheet (từ 1). */
  row: number;
  /** Tên mục phase chứa dòng này, ví dụ "Phase 2". */
  phase: string;
  /** Cột Screen đã điền lại cho các ô trống. */
  screen: string;
  adsName: string;
  /** Ghi chú khi cột Ads name bắt đầu bằng "Note:". */
  note?: string;
  /** Resource name; dùng Ads name thay thế khi trống (D-072). */
  resources: string[];
  resourceSource: 'resource' | 'ads_name' | 'none';
  adsType: AdType;
  adsTypeRaw: string;
  adsId: string;
  /** Key bật/tắt ad; dùng Ads name thay thế khi ad in-app không ghi key (D-072). */
  enableKeys: string[];
  enableKeySource: 'sheet' | 'ads_name' | 'none';
  description: string;
  isHF: boolean;
  hfReason?: 'ads_name' | 'resource' | 'both';
  /** Chỉ có ở ad HF. */
  pairStatus?: PairStatus;
  pairRow?: number;
  /** Chỉ có ở ad thường: các dòng HF ghép với nó. */
  pairedWith?: number[];
  special?: SpecialMatch;
}

export interface PhaseSection {
  name: string;
  /** Dòng của tiêu đề phase (hoặc dòng tiêu đề của file cho phase đầu). 0 nếu không có. */
  row: number;
  ads: number;
}

export type WarningCode =
  | 'missing_id'
  | 'invalid_id'
  | 'duplicate_id'
  | 'resource_multi_id'
  | 'duplicate_key'
  | 'missing_type'
  | 'unknown_type'
  | 'missing_name'
  | 'missing_enable_key'
  | 'key_marker_only'
  | 'unpaired_hf'
  | 'ambiguous_pair'
  | 'empty_phase';

export interface ScriptWarning {
  row: number;
  code: WarningCode;
  message: string;
}

export interface AdScript {
  sheet: string;
  headerRow: number;
  phases: PhaseSection[];
  rows: AdScriptRow[];
  warnings: ScriptWarning[];
  /** Dòng được bỏ qua vì là dòng hướng dẫn mẫu ngay dưới tiêu đề. */
  skippedRows: number[];
}

type Column = 'screen' | 'adsName' | 'resource' | 'description' | 'adsType' | 'adsId' | 'enableKey';

const HEADER_LABELS: ReadonlyArray<[Column, RegExp]> = [
  ['screen', /^screen$/i],
  ['adsName', /^ads name$/i],
  ['resource', /^resource name/i],
  ['description', /^description$/i],
  ['adsType', /^ads type$/i],
  ['adsId', /^ads id$/i],
  ['enableKey', /^remote config/i],
];
const REQUIRED: readonly Column[] = ['adsName', 'adsType', 'adsId'];
const HEADER_SCAN_ROWS = 60;

/** Bảng ánh xạ cột Ads type của kịch bản sang loại ad (D-067). Giá trị lạ không đoán. */
const SCRIPT_TYPES: Record<string, AdType> = {
  interstitial: 'Inter',
  'app open': 'Resume',
  reward: 'Reward',
  native: 'Native',
  banner: 'Banner',
};

const AD_ID_RE = /^ca-app-pub-\d+\/\d+$/;
const PHASE_HEADING_RE = /^phase\s*\d+\b/i;
const PHASE_IN_TITLE_RE = /phase\s*(\d+)/i;
const KEY_MARKER_RE = /^v$/i;
const NOTE_RE = /^note\s*:\s*/i;
const FIRST_PHASE_FALLBACK = '(đầu sheet)';

function splitList(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim();
}

function mapHeader(sheet: SheetData): { row: number; cols: Partial<Record<Column, number>> } {
  const last = Math.min(sheet.maxRow, HEADER_SCAN_ROWS);
  for (let r = 1; r <= last; r++) {
    const cells = sheet.rows.get(r);
    if (!cells) continue;
    const cols: Partial<Record<Column, number>> = {};
    for (const [colNo, text] of cells) {
      const label = oneLine(text);
      for (const [key, re] of HEADER_LABELS) {
        if (cols[key] === undefined && re.test(label)) cols[key] = colNo;
      }
    }
    if (REQUIRED.every((k) => cols[k] !== undefined)) return { row: r, cols };
  }
  throw new ToolError(
    'Không tìm thấy dòng tiêu đề có các cột "Ads name", "Ads type", "Ads ID" trong sheet. Kiểm tra lại sheet đã chọn.',
  );
}

function firstPhaseName(sheet: SheetData, headerRow: number): string {
  for (let r = 1; r < headerRow; r++) {
    for (const text of sheet.rows.get(r)?.values() ?? []) {
      const m = PHASE_IN_TITLE_RE.exec(text);
      if (m) return `Phase ${m[1]}`;
    }
  }
  return FIRST_PHASE_FALLBACK;
}

/** Chuẩn hóa một sheet kịch bản thành danh sách ad (D-071: kiểm mọi mục phase trong sheet). */
export function readAdScript(sheet: SheetData): AdScript {
  const { row: headerRow, cols } = mapHeader(sheet);
  const screenCol = cols.screen ?? 1;
  const mappedCols = Object.values(cols) as number[];
  const get = (r: number, c: number | undefined): string =>
    c === undefined ? '' : (sheet.rows.get(r)?.get(c) ?? '');

  const rows: AdScriptRow[] = [];
  const warnings: ScriptWarning[] = [];
  const skippedRows: number[] = [];
  const phases: PhaseSection[] = [{ name: firstPhaseName(sheet, headerRow), row: 0, ads: 0 }];
  let screen = '';
  let firstDataRow = true;

  const warn = (row: number, code: WarningCode, message: string): void => {
    warnings.push({ row, code, message });
  };

  for (let r = headerRow + 1; r <= sheet.maxRow; r++) {
    const cells = sheet.rows.get(r);
    if (!cells) continue;
    const screenCell = get(r, screenCol);

    // Dòng tiêu đề phase: chỉ có ô Screen dạng "Phase N", các cột còn lại trống
    const othersEmpty = mappedCols.every((c) => c === screenCol || get(r, c) === '');
    if (screenCell !== '' && PHASE_HEADING_RE.test(oneLine(screenCell)) && othersEmpty) {
      phases.push({ name: oneLine(screenCell), row: r, ads: 0 });
      screen = '';
      firstDataRow = false;
      continue;
    }

    const rawName = oneLine(get(r, cols.adsName));
    const rawResource = get(r, cols.resource);
    const rawType = oneLine(get(r, cols.adsType));
    const rawId = get(r, cols.adsId);
    const rawKey = get(r, cols.enableKey);

    // Dòng hướng dẫn mẫu ngay dưới tiêu đề: không có Ads ID và Ads type
    if (firstDataRow) {
      firstDataRow = false;
      if (rawId === '' && rawType === '') {
        skippedRows.push(r);
        continue;
      }
    }
    if (screenCell !== '') screen = oneLine(screenCell);
    if (rawName === '' && rawResource === '' && rawType === '' && rawId === '' && rawKey === '') continue;

    // Ads name: có thể là ghi chú "Note: ..."
    let adsName = rawName;
    let note: string | undefined;
    if (NOTE_RE.test(adsName)) {
      // D-084: kiểm như dòng bình thường theo resource, key và ID; Ads name không dùng để đối chiếu
      note = adsName.replace(NOTE_RE, '');
      adsName = '';
    }

    // Resource name và key bật/tắt; D-072: ad in-app dùng Ads name thay thế
    const sheetResources = splitList(rawResource);
    const keyItems = splitList(rawKey);
    const markerOnly = keyItems.length > 0 && keyItems.every((k) => KEY_MARKER_RE.test(k));
    const realKeys = keyItems.filter((k) => !KEY_MARKER_RE.test(k));

    let resources: string[];
    let resourceSource: AdScriptRow['resourceSource'];
    if (sheetResources.length > 0) {
      resources = sheetResources;
      resourceSource = 'resource';
    } else if (adsName !== '') {
      resources = [adsName];
      resourceSource = 'ads_name';
    } else {
      resources = [];
      resourceSource = 'none';
    }

    let enableKeys: string[];
    let enableKeySource: AdScriptRow['enableKeySource'];
    if (realKeys.length > 0) {
      enableKeys = realKeys;
      enableKeySource = 'sheet';
    } else if (resourceSource === 'ads_name') {
      enableKeys = [adsName];
      enableKeySource = 'ads_name';
    } else {
      enableKeys = [];
      enableKeySource = 'none';
      if (resourceSource === 'resource') {
        if (markerOnly) {
          warn(r, 'key_marker_only', 'Cột Remote config chỉ có dấu "v", không có tên key.');
        } else {
          warn(r, 'missing_enable_key', 'Thiếu enable key (cột Remote config in LIB).');
        }
      }
    }
    if (resourceSource === 'none') {
      warn(r, 'missing_name', 'Dòng không có Ads name lẫn Resource name.');
    }

    // Loại ad (D-067) và Ads ID
    const mapped = SCRIPT_TYPES[rawType.toLowerCase().replace(/\s+/g, ' ')];
    const adsType: AdType = mapped ?? 'Unknown';
    if (rawType === '') warn(r, 'missing_type', 'Thiếu Ads type.');
    else if (!mapped) warn(r, 'unknown_type', `Ads type "${rawType.slice(0, 40)}" ngoài bảng ánh xạ, cần xem.`);

    if (rawId === '') warn(r, 'missing_id', 'Thiếu Ads ID.');
    else if (!AD_ID_RE.test(rawId)) warn(r, 'invalid_id', `Ads ID không đúng định dạng (${rawId.slice(0, 50)}).`);

    // Nhận diện HF (D-064): Ads name hậu tố 2ID, hoặc resource name hậu tố hf
    const nameHF = /2id$/i.test(adsName);
    const resourceHF = resourceSource === 'resource' && resources.some((x) => /hf$/i.test(x));
    const isHF = nameHF || resourceHF;

    const phase = phases[phases.length - 1];
    phase.ads++;
    const special = matchSpecialCase([...resources, ...enableKeys, adsName]);

    rows.push({
      row: r,
      phase: phase.name,
      screen,
      adsName,
      ...(note !== undefined ? { note } : {}),
      resources,
      resourceSource,
      adsType,
      adsTypeRaw: rawType,
      adsId: rawId,
      enableKeys,
      enableKeySource,
      description: oneLine(get(r, cols.description)),
      isHF,
      ...(isHF ? { hfReason: nameHF && resourceHF ? 'both' : nameHF ? 'ads_name' : 'resource' } : {}),
      ...(special ? { special } : {}),
    } as AdScriptRow);
  }

  pairHighFloor(rows, warn);
  flagRelations(rows, warn);
  for (const p of phases) {
    if (p.ads === 0 && p.row > 0) warn(p.row, 'empty_phase', `${p.name} không có ad nào.`);
  }

  return { sheet: sheet.name, headerRow, phases, rows, warnings, skippedRows };
}

/** Bỏ hậu tố HF hoặc `_2` khỏi resource name (D-069, D-074); undefined nếu không có hậu tố nào. */
function stripResourceSuffix(resource: string): string | undefined {
  if (/_hf$/i.test(resource)) return resource.slice(0, -3);
  if (/hf$/i.test(resource)) return resource.slice(0, -2);
  if (/_2$/.test(resource)) return resource.slice(0, -2);
  return undefined;
}

/**
 * Ghép cặp ad HF với ad thường (D-069, D-072, D-074, D-075):
 *  - ad thuộc case đặc biệt: không ghép, trạng thái special_case;
 *  - resource lấy từ cột Resource: bỏ `_hf` hoặc `_2`, tìm ad thường có resource trùng;
 *  - resource lấy thay từ Ads name: bỏ `2ID`, tìm ad thường có cùng Ads name;
 *  - không ghép được thì unpaired, nhiều ứng viên thì ambiguous.
 * Không dùng cặp do log khai báo (D-069), không suy đoán khi khác cụm tên.
 */
function pairHighFloor(
  rows: AdScriptRow[],
  warn: (row: number, code: WarningCode, message: string) => void,
): void {
  const normal = rows.filter((x) => !x.isHF);
  for (const hf of rows) {
    if (!hf.isHF) continue;
    if (hf.special) {
      hf.pairStatus = 'special_case';
      continue;
    }
    const matches = new Set<number>();
    if (hf.resourceSource === 'resource') {
      for (const res of hf.resources) {
        const base = stripResourceSuffix(res);
        if (base === undefined || base === '') continue;
        for (const n of normal) {
          if (n.resourceSource === 'resource' && n.resources.some((x) => x.toLowerCase() === base.toLowerCase())) {
            matches.add(n.row);
          }
        }
      }
    } else if (hf.resourceSource === 'ads_name') {
      const base = hf.adsName.replace(/_?2ID$/i, '');
      for (const n of normal) {
        if (n.adsName !== '' && n.adsName.toLowerCase() === base.toLowerCase()) matches.add(n.row);
      }
    }

    if (matches.size === 1) {
      const pairRow = [...matches][0];
      hf.pairStatus = 'paired';
      hf.pairRow = pairRow;
      const partner = normal.find((n) => n.row === pairRow)!;
      (partner.pairedWith ??= []).push(hf.row);
    } else if (matches.size > 1) {
      hf.pairStatus = 'ambiguous';
      warn(hf.row, 'ambiguous_pair', `Ad HF khớp nhiều ad thường (dòng ${[...matches].join(', ')}).`);
    } else {
      hf.pairStatus = 'unpaired';
      warn(hf.row, 'unpaired_hf', 'Không xác định được cặp ad thường cho ad HF này.');
    }
  }
}

/**
 * Kiểm quan hệ key, Ads name/resource name và ID (D-088, D-090): nhiều ad có thể dùng chung một ID (chỉ ghi
 * chú) và một ad có thể có nhiều key, nhưng một resource name không được có nhiều ID và một key chỉ thuộc một ad.
 */
function flagRelations(
  rows: AdScriptRow[],
  warn: (row: number, code: WarningCode, message: string) => void,
): void {
  const idSeen = new Map<string, number>();
  const resourceSeen = new Map<string, { row: number; id: string }>();
  const keySeen = new Map<string, { row: number; resources: string }>();
  for (const r of rows) {
    if (r.adsId !== '') {
      const first = idSeen.get(r.adsId);
      if (first === undefined) idSeen.set(r.adsId, r.row);
      else warn(r.row, 'duplicate_id', `Ads ID dùng chung với dòng ${first} (nhiều ad có thể dùng chung một ID, D-088); kiểm tra theo ID gộp cả hai dòng.`);
    }
    if (r.resourceSource === 'resource' && r.adsId !== '') {
      for (const res of r.resources) {
        const prev = resourceSeen.get(res.toLowerCase());
        if (!prev) resourceSeen.set(res.toLowerCase(), { row: r.row, id: r.adsId });
        else if (prev.id !== r.adsId) {
          warn(r.row, 'resource_multi_id', `Resource ${res} có ID khác với dòng ${prev.row}; một resource chỉ có một ID (D-088).`);
        }
      }
    }
    if (r.enableKeySource === 'sheet') {
      const resources = r.resources.map((x) => x.toLowerCase()).sort().join(',');
      for (const key of r.enableKeys) {
        const prev = keySeen.get(key.toLowerCase());
        if (!prev) keySeen.set(key.toLowerCase(), { row: r.row, resources });
        else if (prev.resources !== resources) {
          warn(r.row, 'duplicate_key', `Key ${key} đã ghi cho dòng ${prev.row}; mỗi key chỉ thuộc một ad (D-090).`);
        }
      }
    }
  }
}
