// End-to-end check of the HTTP transport: start http.js, connect like a remote client, call a tool.
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = 3399;
const child = spawn(process.execPath, ['src/http.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'pipe'] });
try {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const client = new Client({ name: 'yieldcave-smoke-http', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`)));
  const { tools } = await client.listTools();
  console.log('tools:', tools.map((t) => t.name).join(', '));
  const r = await client.callTool({ name: 'get_rwa_asset', arguments: { symbol: 'BUIDL' } });
  const a = JSON.parse(r.content[0].text);
  console.log('BUIDL chains:', a.chains?.join(', '), 'total TVL:', a.totalTvlUsd);
  await client.close();
  // The Node HTTP entry point has no history or alert store, so it serves the ten base tools.
if (tools.length !== 10 || !a.found) { console.error('SMOKE-HTTP FAIL'); process.exit(1); }
  console.log('SMOKE-HTTP PASS');
} finally {
  child.kill();
}
