#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { DualEraTransport } from './dual-era-transport.js';
import { createServer, DISCOVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from './server.js';

/**
 * Điểm vào của MCP server: chạy local qua stdio (D-062). stdout chỉ dành cho giao thức, log ra stderr.
 * Nói cả hai thế hệ: modern 2026-07-28 (per-request `_meta`, `server/discover`) và legacy
 * (handshake `initialize`) trên cùng một tiến trình.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new DualEraTransport(new StdioServerTransport(), {
    server: { name: SERVER_NAME, version: SERVER_VERSION },
    legacyVersions: SUPPORTED_PROTOCOL_VERSIONS,
    // Danh sách tool tĩnh, chưa có subscriptions/listen nên không khai báo listChanged.
    capabilities: { tools: {} },
    instructions: DISCOVER_INSTRUCTIONS,
  });
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] ${SERVER_VERSION} đang chạy (stdio)`);
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] không khởi động được:`, err);
  process.exit(1);
});
