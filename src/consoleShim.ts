// MCP stdio transport reserves stdout for JSON-RPC frames only. Any stray
// console.log / info / warn anywhere in the dependency tree corrupts the
// stream and the client rejects frames with "Unexpected token" errors.
// Redirect non-error console output to stderr so existing logs stay visible
// but no longer pollute stdout. Imported first from stdio.ts so it runs
// before dotenv, the MCP SDK, and any core/* modules initialize.

const redirect = (...args: unknown[]) => console.error(...args);
console.log = redirect;
console.info = redirect;
console.warn = redirect;

export {};
