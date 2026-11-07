import { type LogEntry, timeToMs, TESTER_TAG_PREFIX } from './logcat.js';

/** 5 loại ad theo D-067. `Unknown` là giá trị lạ ngoài bảng ánh xạ, báo lại chứ không đoán. */
export type AdType = 'Inter' | 'Resume' | 'Reward' | 'Native' | 'Banner' | 'Unknown';

export type AdEventKind = 'load_start' | 'load_ok' | 'load_fail' | 'show';

export interface AdEvent {
  kind: AdEventKind;
  /** Ad unit id; chuỗi rỗng nếu log in id trống (ví dụ `OnlyId(adUnitId=)`). */
  id: string;
  adType: AdType;
  time: string;
  ms: number;
  entryIndex: number;
  line: number;
  /** Chỉ có ở `load_fail`: nội dung lỗi đã rút gọn. */
  error?: string;
}

export interface AdSummary {
  id: string;
  adType: AdType;
  loadStart: number;
  loadOk: number;
  loadFail: number;
  show: number;
  lastError?: string;
  firstTime: string;
  lastTime: string;
}

export interface AdAnalysis {
  events: AdEvent[];
  ads: AdSummary[];
  /** Nhãn loại ad không có trong bảng ánh xạ. */
  unknownTypeLabels: string[];
}

/** Bảng ánh xạ loại ad, lấy từ file mẫu (mvp.md, mục "Nhận diện ad và ánh xạ loại"). */
const LOAD_AD_TYPES: Record<string, AdType> = {
  Interstitial: 'Inter',
  Open: 'Resume',
  Reward: 'Reward',
  Native: 'Native',
  Banner: 'Banner',
};
const SHOW_TYPES: Record<string, AdType> = {
  INTERSTITIAL: 'Inter',
  APP_OPEN: 'Resume',
  REWARDED: 'Reward',
  NATIVE: 'Native',
  BANNER: 'Banner',
};

const AD_ID_RE = /ca-app-pub-\d+\/\d+/;
const ADUNIT_FIELD_RE = /adUnitId[=:]([^,)\s]*)/;
const LOAD_LABEL_RE = /^([A-Za-z]+) ad:/;
const SHOW_RE = /^([A-Z_]+) - (\S+)\s*$/;
const FAILURE_RE = /^([A-Z_]+) - (\S+) - (.*)$/;
const ERROR_MAX = 120;

/** Hai dòng báo cùng một lần load fail cách nhau không quá khoảng này thì gộp làm một. */
const FAIL_DEDUP_WINDOW_MS = 2000;

interface RawEvent extends AdEvent {
  /** Nguồn của dòng log, dùng để gộp dòng fail bị in lặp. */
  source: string;
}

function extractId(message: string): string {
  const m = AD_ID_RE.exec(message);
  if (m) return m[0];
  const f = ADUNIT_FIELD_RE.exec(message);
  return f ? f[1] : '';
}

/** "FailToLoad(No fill.)" -> "No fill."; bỏ link hướng dẫn kèm theo. */
function cleanError(raw: string): string {
  let s = raw.trim();
  const wrapped = /^FailToLoad\((.*)\)$/s.exec(s);
  if (wrapped) s = wrapped[1];
  s = s.replace(/<https?:[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return s.length > ERROR_MAX ? `${s.slice(0, ERROR_MAX)}...` : s;
}

function makeEvent(
  e: LogEntry,
  kind: AdEventKind,
  id: string,
  adType: AdType,
  source: string,
  error?: string,
): RawEvent {
  return {
    kind,
    id,
    adType,
    time: e.time,
    ms: timeToMs(e.time),
    entryIndex: e.index,
    line: e.line,
    error,
    source,
  };
}

function extractEvent(e: LogEntry, unknownLabels: Set<string>): RawEvent | undefined {
  const tag = e.tag.startsWith(TESTER_TAG_PREFIX) ? e.tag.slice(TESTER_TAG_PREFIX.length) : '';
  const msg = e.message;

  if (tag === 'LOAD_AD') {
    const label = LOAD_LABEL_RE.exec(msg)?.[1] ?? '';
    const adType = LOAD_AD_TYPES[label];
    if (!adType) {
      if (label) unknownLabels.add(label);
    }
    const type: AdType = adType ?? 'Unknown';
    const id = extractId(msg);

    if (/starting load ad/.test(msg)) return makeEvent(e, 'load_start', id, type, 'LOAD_AD:start');
    if (/has loaded successfully|has loaded with result: Loaded|load ad success/.test(msg)) {
      return makeEvent(e, 'load_ok', id, type, 'LOAD_AD:ok');
    }
    const err = /has load error with result:\s*(.*)$/s.exec(msg);
    if (err) return makeEvent(e, 'load_fail', id, type, 'LOAD_AD:error', cleanError(err[1]));
    // Native in thêm một dòng "load native ad single with result: ... FailToLoad(...)" cho cùng lần fail
    const single = /load native ad single with result:.*?(FailToLoad\(.*\))\s*$/s.exec(msg);
    if (single) return makeEvent(e, 'load_fail', id, type, 'LOAD_AD:single', cleanError(single[1]));
    return undefined;
  }

  if (tag === 'SHOW_AD') {
    const m = SHOW_RE.exec(msg);
    if (!m) return undefined;
    const adType = SHOW_TYPES[m[1]];
    if (!adType) unknownLabels.add(m[1]);
    return makeEvent(e, 'show', extractId(m[2]) || m[2], adType ?? 'Unknown', 'SHOW_AD');
  }

  if (tag === 'LOAD_FAILURE') {
    const m = FAILURE_RE.exec(msg);
    if (!m) return undefined;
    const adType = SHOW_TYPES[m[1]];
    if (!adType) unknownLabels.add(m[1]);
    return makeEvent(
      e,
      'load_fail',
      extractId(m[2]) || m[2],
      adType ?? 'Unknown',
      'LOAD_FAILURE',
      cleanError(m[3]),
    );
  }

  return undefined;
}

/**
 * Trích ad event từ các tag LOAD_AD, SHOW_AD, LOAD_FAILURE.
 *
 * Một lần load fail có thể được in nhiều dòng (LOAD_AD "has load error", LOAD_AD
 * "load native ad single", LOAD_FAILURE). Các dòng đó gộp thành một event nếu cùng ID,
 * đến từ nguồn khác nhau và cách nhau không quá FAIL_DEDUP_WINDOW_MS. Hai dòng cùng nguồn
 * luôn là hai lần fail riêng.
 */
export function analyzeAds(entries: LogEntry[]): AdAnalysis {
  const unknownLabels = new Set<string>();
  const events: AdEvent[] = [];
  /** Event fail gần nhất của mỗi ID, kèm các nguồn đã gộp vào. */
  const lastFail = new Map<string, { event: AdEvent; sources: Set<string> }>();

  for (const entry of entries) {
    const raw = extractEvent(entry, unknownLabels);
    if (!raw) continue;
    const { source, ...ev } = raw;

    if (ev.kind === 'load_fail') {
      const prev = lastFail.get(ev.id);
      if (prev && !prev.sources.has(source) && ev.ms - prev.event.ms <= FAIL_DEDUP_WINDOW_MS) {
        prev.sources.add(source);
        if (prev.event.adType === 'Unknown' && ev.adType !== 'Unknown') prev.event.adType = ev.adType;
        if (!prev.event.error && ev.error) prev.event.error = ev.error;
        continue;
      }
      lastFail.set(ev.id, { event: ev, sources: new Set([source]) });
    }
    events.push(ev);
  }

  return { events, ads: summarize(events), unknownTypeLabels: [...unknownLabels].sort() };
}

function summarize(events: AdEvent[]): AdSummary[] {
  const byId = new Map<string, AdSummary>();
  for (const ev of events) {
    let s = byId.get(ev.id);
    if (!s) {
      s = {
        id: ev.id,
        adType: ev.adType,
        loadStart: 0,
        loadOk: 0,
        loadFail: 0,
        show: 0,
        firstTime: ev.time,
        lastTime: ev.time,
      };
      byId.set(ev.id, s);
    }
    if (s.adType === 'Unknown' && ev.adType !== 'Unknown') s.adType = ev.adType;
    s.lastTime = ev.time;
    switch (ev.kind) {
      case 'load_start':
        s.loadStart++;
        break;
      case 'load_ok':
        s.loadOk++;
        break;
      case 'load_fail':
        s.loadFail++;
        if (ev.error) s.lastError = ev.error;
        break;
      case 'show':
        s.show++;
        break;
    }
  }
  return [...byId.values()];
}
