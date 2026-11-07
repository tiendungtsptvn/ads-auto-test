import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  decorateModernResult,
  buildDiscoverResult,
  idKey,
  unsupportedVersionError,
  MODERN_VERSIONS,
  META_VERSION,
  META_CLIENT_CAPS,
  META_CLIENT_INFO,
  META_SERVER_INFO,
  CACHE_TTL_MS,
} from '../dist/protocol.js';

const LEGACY = ['2025-11-25', '2025-06-18'];
const SERVER = { name: 'ads-test-mcp', version: '9.9.9' };
const modernMeta = (extra = {}) => ({
  [META_VERSION]: '2026-07-28',
  [META_CLIENT_CAPS]: {},
  [META_CLIENT_INFO]: { name: 'c', version: '1' },
  ...extra,
});
const req = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('classify: notification và response luôn đi thẳng', () => {
  assert.deepEqual(classify({ jsonrpc: '2.0', method: 'notifications/initialized' }, LEGACY), { kind: 'passthrough' });
  assert.deepEqual(classify({ jsonrpc: '2.0', id: 1, result: {} }, LEGACY), { kind: 'passthrough' });
});

test('classify: initialize và request không có _meta modern là legacy', () => {
  assert.equal(classify(req('initialize', { protocolVersion: '2025-11-25' }), LEGACY).kind, 'passthrough');
  assert.equal(classify(req('tools/list', {}), LEGACY).kind, 'passthrough');
  assert.equal(classify(req('tools/list'), LEGACY).kind, 'passthrough');
  // _meta chỉ có progressToken không làm request thành modern
  assert.equal(classify(req('tools/call', { name: 'x', _meta: { progressToken: 5 } }), LEGACY).kind, 'passthrough');
});

test('classify: request modern hợp lệ', () => {
  const c = classify(req('tools/call', { name: 'x', _meta: modernMeta() }), LEGACY);
  assert.deepEqual(c, { kind: 'modern', method: 'tools/call' });
});

test('classify: clientInfo là tùy chọn, clientCapabilities rỗng vẫn hợp lệ', () => {
  const meta = { [META_VERSION]: '2026-07-28', [META_CLIENT_CAPS]: {} };
  assert.equal(classify(req('tools/list', { _meta: meta }), LEGACY).kind, 'modern');
});

test('classify: server/discover hợp lệ được trả lời trực tiếp', () => {
  assert.deepEqual(classify(req('server/discover', { _meta: modernMeta() }), LEGACY), { kind: 'discover' });
});

test('classify: thiếu trường bắt buộc của _meta bị -32602', () => {
  const noCaps = { [META_VERSION]: '2026-07-28' };
  const noVersion = { [META_CLIENT_CAPS]: {} };
  const badCaps = { [META_VERSION]: '2026-07-28', [META_CLIENT_CAPS]: 'x' };
  for (const meta of [noCaps, noVersion, badCaps]) {
    const c = classify(req('tools/list', { _meta: meta }), LEGACY);
    assert.equal(c.kind, 'reject');
    assert.equal(c.error.code, -32602);
  }
  // discover luôn là method modern nên bắt buộc có _meta
  for (const params of [undefined, {}, { _meta: {} }]) {
    const c = classify(req('server/discover', params), LEGACY);
    assert.equal(c.kind, 'reject');
    assert.equal(c.error.code, -32602);
  }
});

test('classify: version lạ bị -32022 kèm supported và requested', () => {
  const c = classify(req('tools/list', { _meta: modernMeta({ [META_VERSION]: '1900-01-01' }) }), LEGACY);
  assert.equal(c.kind, 'reject');
  assert.equal(c.error.code, -32022);
  assert.deepEqual(c.error.data.supported, ['2026-07-28', ...LEGACY]);
  assert.equal(c.error.data.requested, '1900-01-01');
});

test('classify: version legacy khai trong _meta thì phục vụ theo legacy', () => {
  const c = classify(req('tools/list', { _meta: modernMeta({ [META_VERSION]: '2025-11-25' }) }), LEGACY);
  assert.equal(c.kind, 'passthrough');
  const d = classify(req('server/discover', { _meta: modernMeta({ [META_VERSION]: '2025-11-25' }) }), LEGACY);
  assert.equal(d.kind, 'passthrough');
});

test('decorateModernResult: thêm resultType và serverInfo, giữ nguyên nội dung gốc', () => {
  const result = { content: [{ type: 'text', text: 'x' }], structuredContent: { a: 1 }, isError: false };
  const out = decorateModernResult('tools/call', result, SERVER);
  assert.equal(out.resultType, 'complete');
  assert.deepEqual(out.content, result.content);
  assert.deepEqual(out.structuredContent, { a: 1 });
  assert.deepEqual(out._meta[META_SERVER_INFO], SERVER);
  assert.equal(out.ttlMs, undefined, 'tools/call không cacheable');
  assert.equal(out.cacheScope, undefined);
  assert.equal(result.resultType, undefined, 'không sửa object gốc');
});

test('decorateModernResult: tools/list có ttlMs >= 0 và cacheScope hợp lệ', () => {
  const out = decorateModernResult('tools/list', { tools: [] }, SERVER);
  assert.equal(out.resultType, 'complete');
  assert.ok(Number.isInteger(out.ttlMs) && out.ttlMs >= 0);
  assert.equal(out.ttlMs, CACHE_TTL_MS);
  assert.ok(['public', 'private'].includes(out.cacheScope));
});

test('decorateModernResult: giữ _meta sẵn có của kết quả', () => {
  const out = decorateModernResult('tools/call', { content: [], _meta: { keep: 1 } }, SERVER);
  assert.equal(out._meta.keep, 1);
  assert.deepEqual(out._meta[META_SERVER_INFO], SERVER);
});

test('buildDiscoverResult: đủ trường theo discover.md', () => {
  const r = buildDiscoverResult(SERVER, { tools: {} }, 'hướng dẫn');
  assert.equal(r.resultType, 'complete');
  assert.deepEqual(r.supportedVersions, [...MODERN_VERSIONS]);
  assert.deepEqual(r.capabilities, { tools: {} });
  assert.deepEqual(r._meta[META_SERVER_INFO], SERVER);
  assert.equal(r.instructions, 'hướng dẫn');
  assert.ok(r.ttlMs >= 0);
  assert.ok(['public', 'private'].includes(r.cacheScope));
  assert.equal('instructions' in buildDiscoverResult(SERVER, {}), false);
});

test('idKey phân biệt id số và id chuỗi', () => {
  assert.notEqual(idKey(1), idKey('1'));
  assert.equal(idKey('a'), idKey('a'));
});

test('unsupportedVersionError: requested không phải chuỗi thì null', () => {
  assert.equal(unsupportedVersionError(42, LEGACY).data.requested, null);
});
