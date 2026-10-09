// Save today's market as a local snapshot (npm run snapshot). The hosted version does this hourly on its own.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMarket, fileHistory } from './data.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const market = await loadMarket();
const day = await fileHistory(path.join(root, '.cache', 'snapshots'), fs).save(market);
console.log(`saved snapshot for ${day}: ${market.assets.length} assets`);
