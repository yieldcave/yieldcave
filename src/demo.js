// Run `npm run demo` to see the data in your terminal without any MCP client.
import { loadMarket } from './data.js';
import { marketSummary, listAssets, compareYield } from './tools.js';

const market = await loadMarket();
const summary = marketSummary(market);
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

console.log(`\nYieldCave demo  (data: ${market.source}, fetched ${market.fetchedAt})\n`);
console.log(`Tokenized treasuries: ${summary.tokenizedTreasuries.distinctTokens} tokens, ${summary.tokenizedTreasuries.deployments} deployments, ${usd(summary.tokenizedTreasuries.totalTvlUsd)} TVL, median APY ${summary.tokenizedTreasuries.medianApyPercent?.toFixed(2)}%`);
console.log(`Other tokenized RWAs: ${summary.otherRwa.deployments} deployments, ${usd(summary.otherRwa.totalTvlUsd)} TVL\n`);

const top = listAssets(market, { kind: 'treasury', limit: 10 });
console.table(top.assets.map((a) => ({ symbol: a.symbol, project: a.project, chain: a.chain, 'APY %': a.apyPercent?.toFixed(2), TVL: usd(a.tvlUsd) })));

const cmp = compareYield(market, { currentApyPercent: 0.5, amountUsd: 10_000 });
console.log(`\n$10,000 at 0.50% for a year earns ${usd(cmp.projectedInterestUsd.current)}.`);
console.log(`Best liquid tokenized treasury (${cmp.bestTokenizedTreasury.symbol} on ${cmp.bestTokenizedTreasury.chain}, ${cmp.bestTokenizedTreasury.apyPercent.toFixed(2)}%) would earn ${usd(cmp.projectedInterestUsd.bestTokenizedTreasury)}. Difference: ${usd(cmp.projectedInterestUsd.difference)}.`);
console.log(`\n${cmp.disclaimer}\n`);
