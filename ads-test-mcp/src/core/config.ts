import { type LogEntry, TESTER_TAG_PREFIX } from './logcat.js';
import { isSecretKey } from './mask.js';

/**
 * Khối CONFIG của tag FOR_TESTER_CONFIG (D-052): giá trị Remote Config app thật sự dùng.
 *  - `Remote FO Prefs`: một entry nhiều dòng, mỗi dòng `key: value`.
 *  - `FO CONFIG CHECKLIST`: nhiều entry liên tiếp, gồm các section `[AD_UNITS - X]` và dòng `key: value`.
 * App có thể khởi động lại trong cùng file log nên mỗi khối được ghi thành một snapshot riêng.
 */
export interface ConfigSnapshot {
  /** Thời điểm entry `Remote FO Prefs` (hoặc checklist nếu không có prefs). */
  time: string;
  /** Số dòng của entry mở đầu snapshot. */
  line: number;
  /** Nhóm `Remote FO Prefs`: key bật/tắt ad và các tham số FO. */
  prefs: Record<string, string>;
  /** Nhóm `FO CONFIG CHECKLIST`: key chứa ad id (resource name) và các giá trị khác. */
  checklist: Record<string, string>;
  /** Tên section của checklist cho từng key, ví dụ `AD_UNITS - SPLASH`. */
  checklistSection: Record<string, string>;
}

export interface ConfigInfo {
  /** Phiên bản lib ghi ở dòng `Version Lib FIRST OPEN` (lần xuất hiện cuối). */
  libVersion?: string;
  /** Các dòng `Version Lib <tên>: <giá trị>`, ví dụ Ads, Adjust. */
  libVersions: Record<string, string>;
  snapshots: ConfigSnapshot[];
}

const PREFS_HEADER_RE = /^=+\s*Remote FO Prefs\s*=+$/i;
const RULE_ONLY_RE = /^[=═\-─\s]+$/;
const CHECKLIST_TITLE = 'FO CONFIG CHECKLIST';
const SECTION_RE = /^\[([^\]]+)\]$/;
const VERSION_LIB_RE = /^Version Lib ([A-Za-z0-9 ]+?):\s*(\S.*)$/;

const MASKED = '***';

function splitKeyValue(line: string): [string, string] | undefined {
  const idx = line.indexOf(':');
  if (idx <= 0) return undefined;
  const key = line.slice(0, idx).trim();
  if (!key || /\s/.test(key)) return undefined;
  let value = line.slice(idx + 1).trim();
  if (value === '(empty)') value = '';
  return [key, isSecretKey(key) ? MASKED : value];
}

export function extractConfig(entries: LogEntry[]): ConfigInfo {
  const info: ConfigInfo = { libVersions: {}, snapshots: [] };
  let snap: ConfigSnapshot | undefined;
  let section = '';
  let inChecklist = false;
  /** Sau tiêu đề checklist có một dòng kẻ ═ mở đầu, rồi các section, rồi một dòng kẻ ═ kết thúc. */
  let checklistRulesLeft = 0;

  const newSnapshot = (e: LogEntry): ConfigSnapshot => {
    const s: ConfigSnapshot = {
      time: e.time,
      line: e.line,
      prefs: {},
      checklist: {},
      checklistSection: {},
    };
    info.snapshots.push(s);
    return s;
  };

  for (const e of entries) {
    if (e.tag !== `${TESTER_TAG_PREFIX}CONFIG`) continue;
    const msg = e.message;

    const ver = VERSION_LIB_RE.exec(msg);
    if (ver) {
      const name = ver[1].trim();
      if (name.toUpperCase() === 'FIRST OPEN') info.libVersion = ver[2].trim();
      else info.libVersions[name] = ver[2].trim();
      continue;
    }

    if (PREFS_HEADER_RE.test(msg)) {
      snap = newSnapshot(e);
      inChecklist = false;
      for (const line of e.extra) {
        if (RULE_ONLY_RE.test(line)) break;
        const kv = splitKeyValue(line);
        if (kv) snap.prefs[kv[0]] = kv[1];
      }
      continue;
    }

    if (msg === CHECKLIST_TITLE) {
      if (!snap || Object.keys(snap.checklist).length > 0) snap = newSnapshot(e);
      inChecklist = true;
      section = '';
      checklistRulesLeft = 1;
      continue;
    }

    if (!inChecklist || !snap) continue;

    if (RULE_ONLY_RE.test(msg)) {
      // Dòng kẻ ngay sau tiêu đề thì bỏ qua; dòng kẻ sau các section thì kết thúc checklist.
      if (checklistRulesLeft > 0) checklistRulesLeft--;
      else inChecklist = false;
      continue;
    }

    const sec = SECTION_RE.exec(msg);
    if (sec) {
      section = sec[1];
      continue;
    }
    const kv = splitKeyValue(msg);
    if (kv) {
      snap.checklist[kv[0]] = kv[1];
      snap.checklistSection[kv[0]] = section;
    } else {
      inChecklist = false;
    }
  }

  return info;
}
