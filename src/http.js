#!/usr/bin/env node
// YieldCave MCP server over Streamable HTTP, for claude.ai custom connectors and other remote clients.
// Stateless: every request gets a fresh server + transport, so it scales horizontally and needs no sessions.
//   npm run start:http      then POST MCP requests to http://localhost:3333/mcp
import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './mcp.js';

const PORT = Number(process.env.PORT ?? 3333);

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, name: 'yieldcave', version: '0.1.0' }));
  }
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('YieldCave MCP server. Endpoint: /mcp');
  }
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('request failed', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
  }
});

httpServer.listen(PORT, () => console.error(`yieldcave MCP server ready (http) on http://localhost:${PORT}/mcp`));
