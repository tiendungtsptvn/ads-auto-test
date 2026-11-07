import { ToolError } from './errors.js';
import { analyzeAds, type AdAnalysis } from './ad-events.js';
import { extractConfig, type ConfigInfo, type ConfigSnapshot } from './config.js';
import {
  entryText,
  matchesFilter,
  parseLogcat,
  TESTER_TAG_PREFIX,
  type LogEntry,
  type ParsedLog,
} from './logcat.js';
import { maskSecrets } from './mask.js';
import { readTextFile, validateInputFile } from './validate.js';

export const AD_LIMIT_DEFAULT = 15;
export const AD_LIMIT_MAX = 100;
export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 30;
export const ENTRY_TEXT_MAX = 300;
export const CONFIG_VALUES_MAX = 100;
export const MAX_WARNINGS = 5;

export interface AdRow {
  id: string;
  type: string;
  load: number;
  ok: number;
  fail: number;
  show: number;
  err?: string;
  first: string;
  last: string;
}

export interface ParseLogcatResult {
  package: string;
  lib_version: string | null;
  lib_versions: Record<string, string>;
  time_range: { first: string; last: string };
  entries: number;
  total_lines: number;
  unparsed_lines: number;
  tag_counts: Record<string, number>;
  ads: { total: number; offset: number; rows: AdRow[]; next_offset: number | null };
  remote_config: {
    snapshots: number;
    prefs_keys: number;
    checklist_keys: number;
    /** Tên key trong `Remote FO Prefs` có giá trị khác nhau giữa snapshot đầu và cuối (tối đa 10). */
    changed_between_snapshots: string[];
    /** Chỉ có khi `include_config`: giá trị của snapshot cuối. */
    values?: {
      prefs: Record<string, string>;
      checklist: Record<string, string>;
      truncated: boolean;
    };
  };
  warnings: string[];
}

export interface ParseLogcatOptions {
  adOffset?: number;
  adLimit?: number;
  includeConfig?: boolean;
  /** Chỉ lấy key có chứa chuỗi này (không phân biệt hoa thường) khi `includeConfig`. */
  configFilter?: string;
}

export interface LoadedLog {
  parsed: ParsedLog;
  ads: AdAnalysis;
  config: ConfigInfo;
}

/** Đọc và phân tích file log. Không giữ trạng thái giữa các lần gọi (server stateless). */
export function loadLog(logPath: unknown): LoadedLog {
  const file = validateInputFile(logPath, 'log_path');
  const parsed = parseLogcat(readTextFile(file));
  if (parsed.entries.length === 0) {
    throw new ToolError('File log không có entry nào đọc được.');
  }
  return {
    parsed,
    ads: analyzeAds(parsed.entries),
    config: extractConfig(parsed.entries),
  };
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function pickLatest(config: ConfigInfo): ConfigSnapshot | undefined {
  return config.snapshots[config.snapshots.length - 1];
}

function changedKeys(config: ConfigInfo): string[] {
  if (config.snapshots.length < 2) return [];
  const first = config.snapshots[0].prefs;
  const last = pickLatest(config)!.prefs;
  const keys = new Set([...Object.keys(first), ...Object.keys(last)]);
  return [...keys].filter((k) => first[k] !== last[k]).sort().slice(0, 10);
}

function filterKeys(
  src: Record<string, string>,
  filter: string | undefined,
  budget: { left: number },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (filter && !k.toLowerCase().includes(filter.toLowerCase())) continue;
    if (budget.left <= 0) break;
    out[k] = v;
    budget.left--;
  }
  return out;
}

function countKeys(src: Record<string, string>, filter: string | undefined): number {
  return Object.keys(src).filter((k) => !filter || k.toLowerCase().includes(filter.toLowerCase()))
    .length;
}

export function buildParseResult(log: LoadedLog, opts: ParseLogcatOptions = {}): ParseLogcatResult {
  const { parsed, ads, config } = log;
  const entries = parsed.entries;
  const adOffset = opts.adOffset ?? 0;
  const adLimit = opts.adLimit ?? AD_LIMIT_DEFAULT;

  const pkgCounts = countBy(entries, (e) => e.pkg);
  const [mainPkg] = [...pkgCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const tagCounts = countBy(entries, (e) => e.tag);

  const rows: AdRow[] = ads.ads.slice(adOffset, adOffset + adLimit).map((a) => ({
    id: a.id,
    type: a.adType,
    load: a.loadStart,
    ok: a.loadOk,
    fail: a.loadFail,
    show: a.show,
    ...(a.lastError ? { err: a.lastError } : {}),
    first: a.firstTime.slice(11),
    last: a.lastTime.slice(11),
  }));
  const nextOffset = adOffset + adLimit < ads.ads.length ? adOffset + adLimit : null;

  const latest = pickLatest(config);
  const remote: ParseLogcatResult['remote_config'] = {
    snapshots: config.snapshots.length,
    prefs_keys: latest ? Object.keys(latest.prefs).length : 0,
    checklist_keys: latest ? Object.keys(latest.checklist).length : 0,
    changed_between_snapshots: changedKeys(config),
  };
  if (opts.includeConfig && latest) {
    const budget = { left: CONFIG_VALUES_MAX };
    const prefs = filterKeys(latest.prefs, opts.configFilter, budget);
    const checklist = filterKeys(latest.checklist, opts.configFilter, budget);
    const total =
      countKeys(latest.prefs, opts.configFilter) + countKeys(latest.checklist, opts.configFilter);
    remote.values = { prefs, checklist, truncated: total > CONFIG_VALUES_MAX };
  }

  return {
    package: mainPkg,
    lib_version: config.libVersion ?? null,
    lib_versions: config.libVersions,
    time_range: { first: entries[0].time, last: entries[entries.length - 1].time },
    entries: entries.length,
    total_lines: parsed.totalLines,
    unparsed_lines: parsed.unparsedLines,
    tag_counts: Object.fromEntries([...tagCounts.entries()].sort((a, b) => b[1] - a[1])),
    ads: { total: ads.ads.length, offset: adOffset, rows, next_offset: nextOffset },
    remote_config: remote,
    warnings: buildWarnings(log, pkgCounts, tagCounts),
  };
}

function buildWarnings(
  log: LoadedLog,
  pkgCounts: Map<string, number>,
  tagCounts: Map<string, number>,
): string[] {
  const w: string[] = [];
  const { parsed, ads, config } = log;

  const foreign = [...tagCounts.entries()].filter(([t]) => !t.startsWith(TESTER_TAG_PREFIX));
  if (foreign.length > 0) {
    const n = foreign.reduce((s, [, c]) => s + c, 0);
    w.push(`Log chưa lọc theo filter FOR_TESTER_: có ${n} entry thuộc ${foreign.length} tag khác.`);
  }
  if (parsed.unparsedLines > 0) {
    w.push(`Có ${parsed.unparsedLines} dòng không đọc được (không có ngày giờ và không thụt lề).`);
  }
  if (pkgCounts.size > 1) {
    w.push(`Log có ${pkgCounts.size} package khác nhau, kết quả lấy package xuất hiện nhiều nhất.`);
  }
  if (config.snapshots.length === 0) {
    w.push('Không thấy khối CONFIG (Remote FO Prefs / FO CONFIG CHECKLIST) trong log.');
  } else if (config.snapshots.length > 1) {
    w.push(`Log có ${config.snapshots.length} lần in CONFIG (app khởi động lại), giá trị lấy từ lần cuối.`);
  }
  if (ads.ads.length === 0) {
    w.push('Không thấy ad event nào (tag LOAD_AD, SHOW_AD, LOAD_FAILURE).');
  }
  if (ads.unknownTypeLabels.length > 0) {
    w.push(`Loại ad ngoài bảng ánh xạ: ${ads.unknownTypeLabels.join(', ')}.`);
  }
  if (ads.ads.some((a) => a.id === '')) {
    w.push('Có ad event với ad id trống (log in adUnitId rỗng), gom chung một dòng id rỗng.');
  }
  return w.slice(0, MAX_WARNINGS);
}

// ---------------------------------------------------------------- search

export interface SearchOptions {
  tag?: string;
  text?: string;
  adId?: string;
  limit?: number;
  cursor?: string;
}

export interface SearchMatch {
  index: number;
  line: number;
  time: string;
  tag: string;
  level: string;
  text: string;
}

export interface SearchLogcatResult {
  matches: SearchMatch[];
  total_matched: number;
  next_cursor: string | null;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function toMatch(e: LogEntry): SearchMatch {
  const flat = maskSecrets(entryText(e)).replace(/\s*\n\s*/g, ' ⏎ ');
  return {
    index: e.index,
    line: e.line,
    time: e.time,
    tag: e.tag,
    level: e.level,
    text: cut(flat, ENTRY_TEXT_MAX),
  };
}

export function searchEntries(entries: LogEntry[], opts: SearchOptions): SearchLogcatResult {
  const limit = Math.min(Math.max(opts.limit ?? SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX);
  let start = 0;
  if (opts.cursor !== undefined) {
    if (!/^\d{1,9}$/.test(opts.cursor)) throw new ToolError('cursor không hợp lệ.');
    start = Number(opts.cursor);
  }

  const filter = { tag: opts.tag, text: opts.text, adId: opts.adId };
  const hits: LogEntry[] = [];
  let total = 0;
  let nextCursor: string | null = null;

  for (const e of entries) {
    if (!matchesFilter(e, filter)) continue;
    total++;
    if (e.index < start) continue;
    if (hits.length < limit) hits.push(e);
    else if (nextCursor === null) nextCursor = String(e.index);
  }
  return { matches: hits.map(toMatch), total_matched: total, next_cursor: nextCursor };
}
