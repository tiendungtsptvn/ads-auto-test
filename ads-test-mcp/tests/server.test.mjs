// Kiểm tra qua giao thức MCP thật: spawn server bằng stdio, dùng client của SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { makeLog, tmpFile, configBlock, ID, loadStart, loadOk, show } from './fixtures.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

async function withClient(fn) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe' });
  const client = new Client({ name: 'ads-test-mcp-tests', version: '0.0.0' });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

const logFile = () =>
  tmpFile(
    makeLog([
      ...configBlock('10:00:00.000', { version: '9.9.9', prefs: { fo_a: 'true' } }),
      loadStart('10:00:01.000', 'Native', ID(1)),
      loadOk('10:00:02.000', 'Native', ID(1)),
      show('10:00:03.000', 'NATIVE', ID(1)),
    ]),
  );

test('tools/list: đủ tool, có inputSchema, outputSchema và annotation chỉ đọc', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['map_remote_keys', 'parse_logcat', 'read_ad_script', 'search_logcat', 'verify_ads']);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, 'object');
      assert.ok(t.inputSchema.required.length >= 1);
      assert.ok(t.outputSchema, `${t.name} thiếu outputSchema`);
      // verify_ads và map_remote_keys ghi file report mới (không bao giờ ghi đè); các tool còn lại chỉ đọc
      const writesReport = t.name === 'verify_ads' || t.name === 'map_remote_keys';
      assert.equal(t.annotations.readOnlyHint, !writesReport, `${t.name}: readOnlyHint`);
      // Hai tool này có thể đọc Firebase (M4) nên là open world
      assert.equal(t.annotations.openWorldHint, writesReport, `${t.name}: openWorldHint`);
      assert.equal(t.annotations.destructiveHint, false);
    }
  });
});

test('tools/call parse_logcat: trả structuredContent kèm văn bản tóm tắt ngắn', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'parse_logcat', arguments: { log_path: logFile() } });
    assert.ok(!res.isError);
    assert.equal(res.structuredContent.lib_version, '9.9.9');
    assert.equal(res.structuredContent.ads.total, 1);
    assert.equal(res.structuredContent.ads.rows[0].show, 1);
    assert.equal(res.content[0].type, 'text');
    assert.ok(res.content[0].text.split('\n').length <= 3);
  });
});

test('tools/call search_logcat: lọc theo tag', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({
      name: 'search_logcat',
      arguments: { log_path: logFile(), tag: 'SHOW_AD' },
    });
    assert.ok(!res.isError);
    assert.equal(res.structuredContent.total_matched, 1);
  });
});

test('lỗi nghiệp vụ: isError, nội dung bắt đầu bằng "Lỗi:", không lộ stack trace', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({
      name: 'parse_logcat',
      arguments: { log_path: '/khong/ton/tai/log.txt' },
    });
    assert.equal(res.isError, true);
    const text = res.content[0].text;
    assert.ok(text.startsWith('Lỗi:'));
    assert.ok(!/\bat \S+ \(/.test(text), 'không được có stack trace');
    assert.ok(!text.includes('khong/ton/tai'));
  });
});

test('tham số sai schema bị từ chối trước khi vào core', async () => {
  await withClient(async (client) => {
    let rejected = false;
    try {
      const res = await client.callTool({
        name: 'search_logcat',
        arguments: { log_path: logFile(), limit: 999 },
      });
      rejected = res.isError === true;
    } catch {
      rejected = true;
    }
    assert.ok(rejected);
  });
});
