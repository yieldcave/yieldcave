// End-to-end check: start the real server over stdio, list tools, call two of them.
// Needs network access (fetches DefiLlama). Run with `npm run smoke`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');
const client = new Client({ name: 'yieldcave-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const summary = await client.callTool({ name: 'rwa_market_summary', arguments: {} });
const s = JSON.parse(summary.content[0].text);
console.log('treasury tokens:', s.tokenizedTreasuries.distinctTokens, 'TVL:', s.tokenizedTreasuries.totalTvlUsd);

const cmp = await client.callTool({ name: 'compare_yield_to_tokenized_treasuries', arguments: { currentApyPercent: 0.5 } });
const c = JSON.parse(cmp.content[0].text);
console.log('best treasury:', c.bestTokenizedTreasury?.symbol, c.bestTokenizedTreasury?.apyPercent, 'diff $', c.projectedInterestUsd?.difference);

if (tools.length !== 12 || !s.tokenizedTreasuries.distinctTokens || !c.bestTokenizedTreasury) {
  console.error('SMOKE FAIL');
  process.exit(1);
}
console.log('SMOKE PASS');
await client.close();
