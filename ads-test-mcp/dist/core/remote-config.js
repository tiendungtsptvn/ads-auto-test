import { ToolError } from './errors.js';
const VALUE_TYPES = new Set(['BOOLEAN', 'NUMBER', 'STRING', 'JSON']);
const KEY_MAX = 256;
function asRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined;
}
function rcValue(v) {
    const r = asRecord(v);
    if (!r)
        return null;
    if (r.useInAppDefault === true)
        return { useInAppDefault: true };
    return typeof r.value === 'string' ? { value: r.value } : null;
}
function readParameters(raw, group, out) {
    const params = asRecord(raw);
    if (!params)
        return;
    for (const [key, p] of Object.entries(params)) {
        const r = asRecord(p);
        if (!r || key.length === 0 || key.length > KEY_MAX)
            continue;
        const conditionalValues = {};
        for (const [cond, cv] of Object.entries(asRecord(r.conditionalValues) ?? {})) {
            const val = rcValue(cv);
            if (val)
                conditionalValues[cond] = val;
        }
        const vt = typeof r.valueType === 'string' && VALUE_TYPES.has(r.valueType) ? r.valueType : 'UNSPECIFIED';
        out.push({ key, group, valueType: vt, defaultValue: rcValue(r.defaultValue), conditionalValues });
    }
}
/** Chuẩn hóa template (nội dung `result` của `firebase remoteconfig:get --json`). */
export function normalizeTemplate(raw) {
    const t = asRecord(raw);
    if (!t)
        throw new ToolError('template Remote Config đọc về không đúng định dạng.');
    const conditions = (Array.isArray(t.conditions) ? t.conditions : [])
        .map(asRecord)
        .filter((c) => !!c && typeof c.name === 'string')
        .map((c) => ({ name: c.name, expression: typeof c.expression === 'string' ? c.expression : '' }));
    const parameters = [];
    readParameters(t.parameters, null, parameters);
    for (const [group, g] of Object.entries(asRecord(t.parameterGroups) ?? {})) {
        readParameters(asRecord(g)?.parameters, group, parameters);
    }
    const v = asRecord(t.version);
    const version = v && (typeof v.versionNumber === 'string' || typeof v.versionNumber === 'number')
        ? { number: String(v.versionNumber), updateTime: typeof v.updateTime === 'string' ? v.updateTime : '' }
        : null;
    return { conditions, parameters, version };
}
const conditionKey = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
/**
 * Tìm condition của tester cho một versionName (D-095). Khớp theo tên sau khi chuẩn hóa (chữ thường, bỏ `_`, `-`,
 * khoảng trắng), nên `Tester_1.0.0` và `tester1.0.0` đều khớp (Q-075). Không dùng biểu thức của condition.
 */
export function findTesterCondition(template, version) {
    const want = conditionKey(`tester${version}`);
    const hits = template.conditions.filter((c) => conditionKey(c.name) === want);
    if (hits.length === 1)
        return hits[0].name;
    const names = template.conditions.map((c) => `"${c.name}"`).join(', ') || '(không có condition nào)';
    if (hits.length > 1) {
        throw new ToolError(`có ${hits.length} condition cùng ứng với Tester_${version}: ${hits.map((c) => `"${c.name}"`).join(', ')}. Báo dev chọn một.`);
    }
    throw new ToolError(`Lỗi: template không có condition Tester_${version} (khớp không phân biệt hoa thường, bỏ qua "_" và "-"). ` +
        `Các condition đang có: ${names}. Kiểm tra lại versionName hoặc condition trên console.`);
}
/**
 * Giá trị dùng để test của mọi key: giá trị riêng của condition tester, không có thì default (D-096).
 * Mọi condition khác bị bỏ qua (D-095).
 */
export function resolveConsoleValues(template, condition) {
    const out = new Map();
    for (const p of template.parameters) {
        const cv = p.conditionalValues[condition];
        const picked = cv ?? p.defaultValue;
        out.set(p.key.toLowerCase(), {
            key: p.key,
            group: p.group,
            valueType: p.valueType,
            value: picked && !picked.useInAppDefault && picked.value !== undefined ? picked.value : null,
            origin: cv ? 'condition' : 'default',
        });
    }
    return out;
}
/** `true` hoặc `false` cho key BOOLEAN có giá trị; còn lại `undefined` (D-099: không tự kiểm). */
export function consoleBool(v) {
    if (!v || v.value === null)
        return undefined;
    if (v.valueType !== 'BOOLEAN' && v.valueType !== 'UNSPECIFIED')
        return undefined;
    const t = v.value.trim().toLowerCase();
    return t === 'true' ? true : t === 'false' ? false : undefined;
}
/** Mô tả ngắn giá trị console cho report: `true (tester1.0.0)` hoặc `false (chỉ có default (prod))`. */
export function describeConsoleValue(v, condition) {
    const val = v.value === null ? '(dùng mặc định trong app)' : v.value.length > 60 ? `${v.value.slice(0, 60)}...` : v.value;
    return `${val} (${v.origin === 'condition' ? condition : 'chỉ có default (prod)'})`;
}
//# sourceMappingURL=remote-config.js.map