import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.js';
import { findTesterCondition, normalizeTemplate, resolveConsoleValues, } from './remote-config.js';
/**
 * Đọc Remote Config bằng `firebase-tools` (hướng A, D-093). Tester đăng nhập bằng `firebase login` trong terminal;
 * token do `firebase-tools` giữ, tool không đọc, không lưu, không truyền token.
 *
 * Chỉ đọc do code bảo đảm (D-004): lệnh con duy nhất được gọi là `remoteconfig:get`, tham số cố định,
 * project id được kiểm định dạng và truyền bằng mảng tham số (không qua shell).
 */
/** Lệnh con duy nhất được phép. Không bao giờ thêm lệnh ghi (D-093). */
export const FIREBASE_READ_COMMANDS = ['remoteconfig:get'];
const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;
const TIMEOUT_MS = 90_000;
const STDOUT_MAX = 20 * 1024 * 1024;
const LOGIN_HINT = 'chạy `firebase login` trong terminal (không làm trong chat) bằng tài khoản có quyền xem project';
const INSTALL_HINT = 'cài một lần bằng `npm install -g firebase-tools` trong terminal rồi chạy `firebase login`';
export function validateProjectId(raw) {
    if (typeof raw !== 'string' || !PROJECT_ID_RE.test(raw)) {
        throw new ToolError('firebase_project_id không hợp lệ: 6 đến 30 ký tự gồm chữ thường, số và "-", ví dụ "aap884-drama-short" (lấy trong URL console).');
    }
    return raw;
}
export function validateVersion(raw) {
    if (typeof raw !== 'string' || !VERSION_RE.test(raw)) {
        throw new ToolError('version không hợp lệ: truyền versionName của bản đang test, ví dụ "1.2.3".');
    }
    return raw;
}
function isFile(p) {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
}
/**
 * Tìm `firebase-tools` trong PATH. Khi tìm được file JavaScript của CLI thì chạy bằng chính Node đang chạy tool,
 * nên trên Windows không phải gọi file `.cmd` qua shell. Bản cài độc lập (file thực thi) thì gọi thẳng.
 */
export function locateFirebase(env = process.env, platform = process.platform) {
    const raw = env.PATH ?? env.Path ?? '';
    const dirs = raw.split(platform === 'win32' ? ';' : ':').filter((d) => d && path.isAbsolute(d));
    for (const dir of dirs) {
        if (platform === 'win32') {
            if (isFile(path.join(dir, 'firebase.cmd'))) {
                const js = path.join(dir, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
                if (isFile(js))
                    return { file: process.execPath, args: [js] };
            }
            const exe = path.join(dir, 'firebase.exe');
            if (isFile(exe))
                return { file: exe, args: [] };
        }
        else {
            const bin = path.join(dir, 'firebase');
            if (!isFile(bin))
                continue;
            let real = bin;
            try {
                real = fs.realpathSync(bin);
            }
            catch {
                continue;
            }
            return real.endsWith('.js') ? { file: process.execPath, args: [real] } : { file: real, args: [] };
        }
    }
    return undefined;
}
const execFirebase = (cmd, args) => new Promise((resolve, reject) => {
    const child = spawn(cmd.file, [...cmd.args, ...args], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        shell: false,
        env: { ...process.env, NO_UPDATE_NOTIFIER: '1', FORCE_COLOR: '0', CI: '1' },
    });
    const chunks = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
    }, TIMEOUT_MS);
    child.stdout.on('data', (b) => {
        size += b.length;
        if (size <= STDOUT_MAX)
            chunks.push(b);
        else
            child.kill();
    });
    child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
    });
    child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), timedOut });
    });
});
/** Thông báo lỗi dễ hiểu theo nội dung lỗi của `firebase-tools`; không trả nguyên văn lỗi gốc. */
export function firebaseErrorMessage(projectId, message) {
    if (/firebase login|authenticat|credential|re-?auth|not logged in/i.test(message)) {
        return `chưa đăng nhập Firebase hoặc phiên đăng nhập đã hết hạn: ${LOGIN_HINT}.`;
    }
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|socket hang up/i.test(message)) {
        return 'không kết nối được tới Firebase (mất mạng, cần VPN hoặc proxy chặn). Kiểm tra mạng rồi thử lại.';
    }
    if (/Remote Config template/i.test(message)) {
        return (`không đọc được Remote Config của project "${projectId}": project id sai, hoặc tài khoản đang đăng nhập không có quyền xem project này. ` +
            'Kiểm tra project id (trong URL console) và tài khoản (`firebase login:list` trong terminal).');
    }
    return `firebase-tools báo lỗi khi đọc Remote Config. Chạy thử \`firebase remoteconfig:get --project ${projectId}\` trong terminal để xem chi tiết.`;
}
async function runRead(sub, projectId, exec, cmd) {
    if (!FIREBASE_READ_COMMANDS.includes(sub)) {
        throw new ToolError('lệnh firebase không được phép (tool chỉ đọc Remote Config).');
    }
    let res;
    try {
        res = await exec(cmd, [sub, '--project', projectId, '--json', '--non-interactive']);
    }
    catch {
        throw new ToolError(`không chạy được firebase-tools: ${INSTALL_HINT}.`);
    }
    if (res.timedOut)
        throw new ToolError('firebase-tools chạy quá lâu (hơn 90 giây). Kiểm tra mạng rồi thử lại.');
    let parsed;
    try {
        parsed = JSON.parse(res.stdout);
    }
    catch {
        throw new ToolError(firebaseErrorMessage(projectId, res.stdout));
    }
    const out = parsed;
    if (out.status !== 'success') {
        throw new ToolError(firebaseErrorMessage(projectId, typeof out.error === 'string' ? out.error : ''));
    }
    return out.result;
}
/** Đọc template đang chạy của một project (một lần gọi `firebase`). */
export async function fetchTemplate(projectId, opts = {}) {
    const cmd = opts.command ?? locateFirebase();
    if (!cmd)
        throw new ToolError(`không tìm thấy firebase-tools trên máy: ${INSTALL_HINT}.`);
    const result = await runRead('remoteconfig:get', projectId, opts.exec ?? execFirebase, cmd);
    return normalizeTemplate(result);
}
/** Đọc template rồi chọn giá trị theo condition `Tester_<version>` (D-095, D-096). */
export async function loadConsoleConfig(rawProjectId, rawVersion, opts = {}) {
    const projectId = validateProjectId(rawProjectId);
    const version = validateVersion(rawVersion);
    const template = await fetchTemplate(projectId, opts);
    const condition = findTesterCondition(template, version);
    return {
        projectId,
        version,
        condition,
        templateVersion: template.version,
        values: resolveConsoleValues(template, condition),
    };
}
//# sourceMappingURL=rc-reader.js.map