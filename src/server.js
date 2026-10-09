#!/usr/bin/env node
// YieldCave MCP server over stdio, for Claude Desktop, Claude Code, Cursor and similar local clients.
// Important: never console.log here. stdout is the protocol channel. Use console.error.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp.js';
import { fileHistory } from './data.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer({ history: fileHistory(path.join(root, '.cache', 'snapshots'), fs) });
await server.connect(new StdioServerTransport());
console.error('yieldcave MCP server ready (stdio)');
