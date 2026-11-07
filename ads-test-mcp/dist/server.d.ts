import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * MCP server local qua stdio (D-062). Stateless: mỗi lần gọi tool tự mang đủ tham số,
 * server không giữ "session hiện tại". Mọi log ghi ra stderr, stdout chỉ dành cho giao thức.
 * Không có resource hay prompt bắt buộc (D-057); hướng dẫn cho agent nằm trong skill `ads-test`.
 */
declare const SERVER_NAME = "ads-test-mcp";
declare const SERVER_VERSION = "0.1.0";
export declare function createServer(): McpServer;
/** Hướng dẫn ngắn cho LLM, trả trong `server/discover`. Quy trình đầy đủ nằm trong skill `ads-test`. */
export declare const DISCOVER_INSTRUCTIONS: string;
export { SERVER_NAME, SERVER_VERSION };
