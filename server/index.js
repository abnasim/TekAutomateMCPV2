/**
 * TekAutomate MCP — mcpb bundle shim
 *
 * This file is the mcpb bundle entry point. The actual MCP server runs
 * remotely (Railway-hosted) or locally (TekAutomate app on port 8787).
 * Claude Desktop connects to it via `mcp-remote`, configured by the
 * user_config.mcp_url field in manifest.json.
 *
 * You should not run this file directly. Open tekautomate-mcp.mcpb
 * with Claude Desktop to install the bundle.
 *
 * For manual Claude Desktop setup, add to claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "tekautomate": {
 *       "command": "npx",
 *       "args": ["-y", "mcp-remote", "https://tekautomatemcpv2.up.railway.app/mcp"]
 *     }
 *   }
 * }
 */
console.log('[TekAutomate MCP] Bundle loaded. Connection handled by mcp-remote.');
console.log('[TekAutomate MCP] See manifest.json user_config.mcp_url to configure the endpoint.');
