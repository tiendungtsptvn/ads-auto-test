// Fixture logcat giả, sinh bằng code theo định dạng Android Studio (không dùng file mẫu thật).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PKG = 'com.example.fakeapp';
export const ID = (n) => `ca-app-pub-0000000000000000/${String(n).padStart(10, '0')}`;

const TAG_W = 24;
const PKG_W = 36;

/** Dòng entry: ngày giờ, pid-tid, tag, package, level, message. */
export function prefix(time, tag, level = 'I', pkg = PKG) {
  return `2026-10-24 ${time}  1234-1234  ${tag.padEnd(TAG_W)} ${pkg.padEnd(PKG_W)} ${level}  `;
}

/**
 * items: [{ t: 'HH:MM:SS.mmm', tag: 'FOR_TESTER_X', level?, msg, more?: string[], pkg? }]
 * Các dòng `more` thụt lề bằng độ dài prefix, giống Android Studio.
 */
export function makeLog(items, { eol = '\n' } = {}) {
  const out = [];
  for (const it of items) {
    const pre = prefix(it.t, it.tag, it.level ?? 'I', it.pkg ?? PKG);
    out.push(pre + it.msg);
    for (const m of it.more ?? []) out.push(' '.repeat(pre.length) + m);
  }
  return out.join(eol) + eol;
}

/** Ghi text ra file tạm, trả đường dẫn tuyệt đối. */
export function tmpFile(content, name = 'log.txt') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-test-mcp-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

const T = 'FOR_TESTER_';

export const loadStart = (t, label, id) => ({
  t,
  tag: `${T}LOAD_AD`,
  level: 'D',
  msg: `${label} ad:Ad with id (${id}) starting load ad ...`,
});
export const loadOk = (t, label, id) => ({
  t,
  tag: `${T}LOAD_AD`,
  level: 'D',
  msg: `${label} ad:Ad with id(OnlyId(adUnitId=${id})) has loaded with result: Loaded(adUnitId:${id}, timeLoaded:900ms)`,
});
export const loadErr = (t, label, id, err = 'No fill.') => ({
  t,
  tag: `${T}LOAD_AD`,
  level: 'D',
  msg: `${label} ad:Ad with id(OnlyId(adUnitId=${id})) has load error with result: FailToLoad(${err})`,
});
export const nativeSingleErr = (t, id, err = 'No fill.') => ({
  t,
  tag: `${T}LOAD_AD`,
  level: 'D',
  msg: `Native ad:load native ad single with result: OnlyId(adUnitId=${id}) FailToLoad(${err})`,
});
export const failureTag = (t, type, id, err = 'No fill.') => ({
  t,
  tag: `${T}LOAD_FAILURE`,
  level: 'E',
  msg: `${type} - ${id} - ${err}`,
});
export const show = (t, type, id) => ({ t, tag: `${T}SHOW_AD`, level: 'E', msg: `${type} - ${id}` });

/** Khối CONFIG giống log thật: prefs là một entry nhiều dòng, checklist là nhiều entry liên tiếp. */
export function configBlock(t0, { version = '1.2.3', prefs = {}, checklist = {} } = {}) {
  const cfg = (t, msg, more) => ({ t, tag: `${T}CONFIG`, msg, more });
  const rule = '═'.repeat(30);
  const items = [
    cfg(t0, `Version Lib FIRST OPEN: ${version}`),
    cfg(t0, '========== Remote FO Prefs ==========', [
      ...Object.entries(prefs).map(([k, v]) => `${k}: ${v}`),
      '================================================',
    ]),
    cfg(t0, rule),
    cfg(t0, '       FO CONFIG CHECKLIST'),
    cfg(t0, rule),
  ];
  for (const [section, kv] of Object.entries(checklist)) {
    items.push(cfg(t0, `[${section}]`));
    for (const [k, v] of Object.entries(kv)) items.push(cfg(t0, `  ${k}: ${v === '' ? '(empty)' : v}`));
  }
  items.push(cfg(t0, rule));
  return items;
}
