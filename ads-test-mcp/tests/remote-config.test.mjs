import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeTemplate,
  findTesterCondition,
  resolveConsoleValues,
  consoleBool,
  describeConsoleValue,
} from '../dist/core/remote-config.js';
import {
  FIREBASE_READ_COMMANDS,
  fetchTemplate,
  loadConsoleConfig,
  locateFirebase,
  firebaseErrorMessage,
  validateProjectId,
  validateVersion,
} from '../dist/core/rc-reader.js';
import { ToolError } from '../dist/core/errors.js';
import { COND, P, template, fakeExec } from './rc-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ chuẩn hóa template

test('normalizeTemplate: gộp key ngoài nhóm và trong nhóm, giữ kiểu, bỏ thông tin người cập nhật', () => {
  const t = normalizeTemplate(
    template({
      params: { banner_all: P('BOOLEAN', 'true'), unlock_episode: P('NUMBER', '1', '2') },
      groups: { Splash: { fo_inter_splash: P('BOOLEAN', 'true', 'false'), fo_x: P('STRING', null) } },
    }),
  );
  assert.deepEqual(
    t.parameters.map((p) => [p.key, p.group, p.valueType]),
    [
      ['banner_all', null, 'BOOLEAN'],
      ['unlock_episode', null, 'NUMBER'],
      ['fo_inter_splash', 'Splash', 'BOOLEAN'],
      ['fo_x', 'Splash', 'STRING'],
    ],
  );
  assert.deepEqual(t.version, { number: '25', updateTime: '2026-11-07T09:30:35.712296Z' });
  assert.ok(!JSON.stringify(t).includes('nguoi-cap-nhat'), 'không giữ email người cập nhật');
  assert.deepEqual(t.parameters[3].defaultValue, { useInAppDefault: true });
  assert.deepEqual(normalizeTemplate({}).parameters, []);
  assert.throws(() => normalizeTemplate(null), ToolError);
});

test('findTesterCondition: khớp tên không phân biệt hoa thường, bỏ "_" "-"; không dùng biểu thức (D-095, Q-075)', () => {
  const t = normalizeTemplate(template());
  assert.equal(findTesterCondition(t, '1.0.0'), COND);
  const t2 = normalizeTemplate(template({ conditions: [{ name: 'Tester_1.2.3', expression: '' }] }));
  assert.equal(findTesterCondition(t2, '1.2.3'), 'Tester_1.2.3');
  // auto_test cũng nhắm version 1.0.0 nhưng không phải condition tester
  const t3 = normalizeTemplate(template({ conditions: [{ name: 'auto_test', expression: "app.version.==(['1.0.0'])" }] }));
  assert.throws(() => findTesterCondition(t3, '1.0.0'), (e) => e instanceof ToolError && /Tester_1\.0\.0/.test(e.message) && /"auto_test"/.test(e.message));
  const dup = normalizeTemplate(template({ conditions: [{ name: 'tester1.0.0' }, { name: 'Tester-1.0.0' }] }));
  assert.throws(() => findTesterCondition(dup, '1.0.0'), /2 condition/);
});

test('resolveConsoleValues: giá trị condition tester, không có thì default; bỏ qua condition khác (D-095, D-096)', () => {
  const t = normalizeTemplate(
    template({
      params: {
        a: P('BOOLEAN', 'true', 'false'),
        b: P('BOOLEAN', 'TRUE'),
        n: P('NUMBER', '5'),
        d: P('BOOLEAN', null),
        other: { valueType: 'BOOLEAN', defaultValue: { value: 'false' }, conditionalValues: { auto_test: { value: 'true' } } },
      },
    }),
  );
  const v = resolveConsoleValues(t, COND);
  assert.deepEqual([v.get('a').value, v.get('a').origin], ['false', 'condition']);
  assert.deepEqual([v.get('b').value, v.get('b').origin], ['TRUE', 'default']);
  assert.equal(v.get('other').value, 'false', 'giá trị của auto_test bị bỏ qua');
  assert.equal(consoleBool(v.get('a')), false);
  assert.equal(consoleBool(v.get('b')), true);
  assert.equal(consoleBool(v.get('n')), undefined, 'NUMBER không phải true/false (D-099)');
  assert.equal(consoleBool(v.get('d')), undefined, 'useInAppDefault');
  assert.match(describeConsoleValue(v.get('b'), COND), /chỉ có default \(prod\)/);
  assert.match(describeConsoleValue(v.get('a'), COND), /tester1\.0\.0/);
});

// ------------------------------------------------------------ gọi firebase (hướng A, D-093)

test('validate: project id và versionName', () => {
  assert.equal(validateProjectId('aap884-drama-short'), 'aap884-drama-short');
  for (const bad of ['', 'AAP884', 'ab', 'x; rm -rf /', '--project', 'a'.repeat(31), 'abc-def-']) {
    assert.throws(() => validateProjectId(bad), ToolError, bad);
  }
  assert.equal(validateVersion('1.2.3'), '1.2.3');
  for (const bad of ['', ' 1.2', '1.2.3; x', '-v']) assert.throws(() => validateVersion(bad), ToolError, bad);
});

test('fetchTemplate: chỉ gọi remoteconfig:get với tham số cố định, đọc JSON từ stdout', async () => {
  const f = fakeExec({ status: 'success', result: template({ params: { k: P('BOOLEAN', 'true') } }) });
  const t = await fetchTemplate('demo-project-01', f);
  assert.equal(t.parameters.length, 1);
  assert.deepEqual(f.calls.map((c) => c.args), [['remoteconfig:get', '--project', 'demo-project-01', '--json', '--non-interactive']]);
  assert.deepEqual([...FIREBASE_READ_COMMANDS], ['remoteconfig:get']);
});

test('loadConsoleConfig: kiểm tham số trước khi gọi firebase; chọn condition theo version', async () => {
  const f = fakeExec({ status: 'success', result: template({ params: { k: P('BOOLEAN', 'true', 'false') } }) });
  await assert.rejects(loadConsoleConfig('BAD ID', '1.0.0', f), /firebase_project_id/);
  await assert.rejects(loadConsoleConfig('demo-project-01', 'x y', f), /version/);
  assert.equal(f.calls.length, 0);
  const cfg = await loadConsoleConfig('demo-project-01', '1.0.0', f);
  assert.equal(cfg.condition, COND);
  assert.equal(cfg.values.get('k').value, 'false');
});

test('lỗi firebase: chưa đăng nhập, sai project hoặc thiếu quyền, mất mạng, không phải JSON, quá giờ, không chạy được firebase-tools', async () => {
  const run = (resp) => fetchTemplate('demo-project-01', fakeExec(resp));
  await assert.rejects(run({ status: 'error', error: 'Failed to authenticate, have you run firebase login?' }), /chưa đăng nhập.*firebase login/);
  await assert.rejects(
    run({ status: 'error', error: 'Failed to get Firebase Remote Config template for project demo-project-01. ' }),
    /project id sai, hoặc tài khoản.*không có quyền/,
  );
  await assert.rejects(run({ status: 'error', error: 'getaddrinfo ENOTFOUND firebaseremoteconfig.googleapis.com' }), /không kết nối được/);
  await assert.rejects(run(() => ({ code: 1, timedOut: false, stdout: 'Error: something' })), /Chạy thử `firebase remoteconfig:get/);
  await assert.rejects(run(() => ({ code: null, timedOut: true, stdout: '' })), /quá lâu/);
  await assert.rejects(
    fetchTemplate('demo-project-01', { command: { file: '/x', args: [] }, exec: async () => { throw new Error('ENOENT'); } }),
    /npm install -g firebase-tools/,
  );
});

test('lỗi không lộ nguyên văn thông báo gốc (có thể chứa token hay đường dẫn)', () => {
  const msg = firebaseErrorMessage('demo-project-01', 'boom ya29.SECRET_TOKEN at /Users/someone/.config/configstore/firebase-tools.json');
  assert.ok(!msg.includes('ya29') && !msg.includes('/Users/'), msg);
});

test('locateFirebase: tìm trong PATH; chạy file JS của CLI bằng Node, không qua shell; Windows dùng bản cài npm cạnh firebase.cmd', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-test-fb-'));
  // macOS/Linux: bin/firebase là symlink tới lib/bin/firebase.js
  fs.mkdirSync(path.join(dir, 'lib', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin'));
  const js = path.join(dir, 'lib', 'bin', 'firebase.js');
  fs.writeFileSync(js, '');
  fs.symlinkSync(js, path.join(dir, 'bin', 'firebase'));
  const posix = locateFirebase({ PATH: `/khong-co:${path.join(dir, 'bin')}` }, 'darwin');
  assert.deepEqual(posix, { file: process.execPath, args: [fs.realpathSync(js)] });
  assert.equal(locateFirebase({ PATH: '/khong-co' }, 'darwin'), undefined);
  assert.equal(locateFirebase({ PATH: 'tuong-doi' }, 'darwin'), undefined, 'bỏ qua thư mục tương đối trong PATH');

  // Windows: %APPDATA%\npm\firebase.cmd và node_modules\firebase-tools\lib\bin\firebase.js
  const npmDir = path.join(dir, 'npm');
  const winJs = path.join(npmDir, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  fs.mkdirSync(path.dirname(winJs), { recursive: true });
  fs.writeFileSync(path.join(npmDir, 'firebase.cmd'), '');
  fs.writeFileSync(winJs, '');
  assert.deepEqual(locateFirebase({ Path: npmDir }, 'win32'), { file: process.execPath, args: [winJs] });
  const exeDir = path.join(dir, 'exe');
  fs.mkdirSync(exeDir);
  fs.writeFileSync(path.join(exeDir, 'firebase.exe'), '');
  assert.deepEqual(locateFirebase({ PATH: exeDir }, 'win32'), { file: path.join(exeDir, 'firebase.exe'), args: [] });
});

test('chạy thật một CLI giả bằng Node: nhận đúng tham số, stdout là JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-test-fbjs-'));
  const fake = path.join(dir, 'firebase.js');
  fs.writeFileSync(
    fake,
    `const t = ${JSON.stringify(template({ params: { k: P('BOOLEAN', 'true') } }))};
     process.stderr.write('npm warn something\\n');
     process.stdout.write(JSON.stringify({ status: 'success', result: { ...t, argv: process.argv.slice(2) } }));`,
  );
  const t = await fetchTemplate('demo-project-01', { command: { file: process.execPath, args: [fake] } });
  assert.equal(t.parameters[0].key, 'k');
});

test('chỉ đọc do code bảo đảm (D-004, D-093): mã nguồn không có lệnh firebase nào khác ngoài remoteconfig:get và không gọi HTTP', () => {
  const srcDir = path.join(ROOT, 'src');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(srcDir);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const cmds = [...text.matchAll(/remoteconfig:[a-z:]+/g)].map((m) => m[0]);
    assert.ok(cmds.every((c) => c === 'remoteconfig:get'), `${path.basename(f)}: ${cmds.join(', ')}`);
    assert.ok(!/\b(rollback|deploy|publishTemplate|updateTemplate)\b/.test(text), `${path.basename(f)} có lệnh ghi`);
    assert.ok(!/\bfetch\(|https?\.request\(|method:\s*['"](PUT|POST|PATCH|DELETE)/.test(text), `${path.basename(f)} gọi HTTP`);
  }
  const reader = fs.readFileSync(path.join(srcDir, 'core', 'rc-reader.ts'), 'utf8');
  assert.match(reader, /shell: false/);
  assert.ok(!/token/i.test(reader.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'rc-reader không xử lý token');
});
