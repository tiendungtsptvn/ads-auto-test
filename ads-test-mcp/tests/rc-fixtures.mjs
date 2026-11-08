// Template Remote Config giả (sinh bằng code, theo cấu trúc đọc thử từ project thật ngày 2026-11-08).
import { normalizeTemplate, findTesterCondition, resolveConsoleValues } from '../dist/core/remote-config.js';

export const COND = 'tester1.0.0';

/** Một tham số: kiểu, giá trị default, giá trị riêng cho condition tester (tùy chọn). */
export const P = (valueType, def, cond) => ({
  valueType,
  defaultValue: def === null ? { useInAppDefault: true } : { value: def },
  ...(cond !== undefined ? { conditionalValues: { [COND]: { value: cond } } } : {}),
});

export function template({ params = {}, groups = {}, conditions } = {}) {
  return {
    conditions: conditions ?? [
      { name: 'auto_test', expression: "app.version.exactlyMatches(['1.0.0']) && device.country in ['VN']" },
      { name: COND, expression: "app.version.==(['1.0.0'])" },
    ],
    parameters: params,
    parameterGroups: Object.fromEntries(Object.entries(groups).map(([g, ps]) => [g, { parameters: ps }])),
    version: {
      versionNumber: '25',
      updateTime: '2026-11-07T09:30:35.712296Z',
      updateUser: { email: 'nguoi-cap-nhat@example.com' },
      updateOrigin: 'CONSOLE',
    },
  };
}

/** ConsoleConfig dựng thẳng từ template giả, không qua firebase. */
export function consoleCfg(tpl, version = '1.0.0', projectId = 'demo-project-01') {
  const t = normalizeTemplate(tpl);
  const condition = findTesterCondition(t, version);
  return { projectId, version, condition, templateVersion: t.version, values: resolveConsoleValues(t, condition) };
}

/** Cách gọi firebase giả: ghi lại tham số, trả JSON như `firebase remoteconfig:get --json`. */
export function fakeExec(response) {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push({ cmd, args });
    if (typeof response === 'function') return response(cmd, args);
    return { code: 0, timedOut: false, stdout: JSON.stringify(response) };
  };
  return { exec, calls, command: { file: '/fake/node', args: ['/fake/firebase.js'] } };
}
