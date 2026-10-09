// Run `npm run demo` to see the data in your terminal without any MCP client.
import { loadMarket } from './data.js';
import { marketSummary, listAssets, compareYield, stablecoinSummary, listStables } from './tools.js';

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
const ss = stablecoinSummary(market);
console.log(`\nStablecoin pools (>= $10M TVL): ${ss.totals.pools} pools, ${usd(ss.totals.tvlUsd)} TVL, median APY ${ss.totals.medianApyPercent}% (tokenized treasuries median ${ss.tokenizedTreasuryMedianApyPercent}%)`);
console.table(listStables(market, { majorOnly: true, group: 'lending', limit: 8 }).pools.map((p) => ({ symbol: p.symbol, project: p.project, chain: p.chain, 'APY %': p.apyPercent?.toFixed(2), '30d %': p.apyMean30dPercent?.toFixed(2), TVL: usd(p.tvlUsd) })));
console.log(`\n${cmp.disclaimer}\n`);
