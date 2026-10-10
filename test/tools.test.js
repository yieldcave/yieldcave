import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarket, loadMarket } from '../src/data.js';
import { listAssets, getAsset, marketSummary, compareYield, median } from '../src/tools.js';

const protocols = [
  { slug: 'blackrock-buidl', category: 'RWA' },
  { slug: 'ondo-yield-assets', category: 'RWA' },
  { slug: 'huma', category: 'RWA' },
  { slug: 'aave-v3', category: 'Lending' },
];

const pools = {
  data: [
    { pool: 'p1', project: 'blackrock-buidl', chain: 'Ethereum', symbol: 'BUIDL', apy: 3.8, apyMean30d: 3.7, tvlUsd: 240_000_000, stablecoin: true },
    { pool: 'p2', project: 'blackrock-buidl', chain: 'Solana', symbol: 'BUIDL', apy: 3.78, apyMean30d: 3.7, tvlUsd: 924_000_000, stablecoin: true },
    { pool: 'p3', project: 'ondo-yield-assets', chain: 'Ethereum', symbol: 'OUSG', apy: 4.0, apyMean30d: 3.9, tvlUsd: 60_000_000, stablecoin: true },
    { pool: 'p4', project: 'ondo-yield-assets', chain: 'Ethereum', symbol: 'TINY', apy: 9.0, apyMean30d: 9.0, tvlUsd: 500_000, stablecoin: true },
    { pool: 'p5', project: 'huma', chain: 'Solana', symbol: 'PST', apy: 10.5, apyMean30d: 10.0, tvlUsd: 400_000_000, stablecoin: true },
    { pool: 'p6', project: 'aave-v3', chain: 'Ethereum', symbol: 'OUSG', apy: 0, apyMean30d: 0, tvlUsd: 39_000_000, stablecoin: true },
  ],
};

const market = buildMarket(pools, protocols, '2026-10-09T00:00:00.000Z');

test('buildMarket keeps only RWA-category projects and tags treasuries', () => {
  assert.equal(market.assets.length, 5);
  assert.ok(!market.assets.some((a) => a.project === 'aave-v3'));
  assert.deepEqual(
    market.assets.filter((a) => a.kind === 'treasury').map((a) => a.symbol).sort(),
    ['BUIDL', 'BUIDL', 'OUSG'],
  );
  assert.equal(market.assets.find((a) => a.symbol === 'PST').kind, 'other_rwa');
});

test('listAssets applies TVL floor, chain filter and sort', () => {
  const all = listAssets(market);
  assert.equal(all.matched, 4, 'TINY is below the default $1M floor');
  assert.equal(all.assets[0].symbol, 'BUIDL');
  assert.equal(all.assets[0].chain, 'Solana', 'sorted by TVL desc');

  const eth = listAssets(market, { chain: 'ethereum', kind: 'treasury' });
  assert.deepEqual(eth.assets.map((a) => a.symbol), ['BUIDL', 'OUSG']);

  const byApy = listAssets(market, { sortBy: 'apy', limit: 1 });
  assert.equal(byApy.assets[0].symbol, 'PST');
  assert.ok(all.disclaimer.includes('not financial advice'));
});

test('getAsset aggregates deployments across chains', () => {
  const r = getAsset(market, 'buidl');
  assert.equal(r.found, true);
  assert.equal(r.totalTvlUsd, 1_164_000_000);
  assert.deepEqual(r.chains, ['Solana', 'Ethereum']);
  assert.equal(r.deployments.length, 2);

  const missing = getAsset(market, 'NOPE');
  assert.equal(missing.found, false);
});

test('marketSummary totals and median', () => {
  const s = marketSummary(market);
  assert.equal(s.tokenizedTreasuries.distinctTokens, 2);
  assert.equal(s.tokenizedTreasuries.deployments, 3);
  assert.equal(s.tokenizedTreasuries.totalTvlUsd, 1_224_000_000);
  assert.equal(s.tokenizedTreasuries.medianApyPercent, 3.8);
  assert.equal(s.tokenizedTreasuries.topByTvl[0].symbol, 'BUIDL');
  assert.equal(s.otherRwa.totalTvlUsd, 400_500_000);
});

test('compareYield uses simple interest and a liquidity floor', () => {
  const c = compareYield(market, { currentApyPercent: 0.5, amountUsd: 10_000, horizonDays: 365 });
  assert.equal(c.bestTokenizedTreasury.symbol, 'OUSG', 'highest APY above the $50M floor');
  assert.equal(c.projectedInterestUsd.current, 50);
  assert.equal(c.projectedInterestUsd.bestTokenizedTreasury, 400);
  assert.equal(c.projectedInterestUsd.difference, 350);

  const strict = compareYield(market, { currentApyPercent: 1, minTvlUsd: 10_000_000_000 });
  assert.equal(strict.bestTokenizedTreasury, null);
});

test('median handles even and odd lengths and nulls', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null, 5]), 5);
  assert.equal(median([]), null);
});

test('loadMarket caches between calls and honours force', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const body = url.includes('protocols') ? protocols : pools;
    return { ok: true, json: async () => body };
  };
  let t = 0;
  const now = () => t;
  const m1 = await loadMarket({ fetchImpl, now, force: true });
  const m2 = await loadMarket({ fetchImpl, now });
  assert.equal(m1, m2);
  assert.equal(calls, 2, 'one fetch per URL, second call served from cache');
  t = 11 * 60 * 1000;
  await loadMarket({ fetchImpl, now });
  assert.equal(calls, 4, 'cache expired after ten minutes');
});

import { historySeries } from '../src/tools.js';
import { fileHistory } from '../src/data.js';

test('historySeries aggregates per day with TVL-weighted APY and reports change', () => {
  const snaps = [
    { day: '2026-10-02', assets: [
      { symbol: 'BUIDL', chain: 'Ethereum', apyPercent: 4, tvlUsd: 100 },
      { symbol: 'BUIDL', chain: 'Solana', apyPercent: 3, tvlUsd: 300 },
      { symbol: 'USDY', chain: 'Ethereum', apyPercent: 5, tvlUsd: 50 },
    ] },
    { day: '2026-10-01', assets: [ { symbol: 'BUIDL', chain: 'Ethereum', apyPercent: 3.5, tvlUsd: 80 } ] },
  ];
  const h = historySeries(snaps, { symbol: 'buidl' });
  assert.deepEqual(h.series.map((r) => r.day), ['2026-10-01', '2026-10-02'], 'sorted ascending');
  assert.equal(h.series[1].totalTvlUsd, 400);
  assert.equal(h.series[1].tvlWeightedApyPercent, 3.25);
  assert.equal(h.change.tvlUsd, 320);
  assert.equal(h.change.apyPercentagePoints, -0.25);
  const eth = historySeries(snaps, { symbol: 'BUIDL', chain: 'ethereum', days: 1 });
  assert.equal(eth.days, 1);
  assert.equal(eth.series[0].totalTvlUsd, 100);
  const none = historySeries(snaps, { symbol: 'NOPE' });
  assert.equal(none.series.every((r) => r.deployments === 0), true);
});

test('fileHistory saves one file per day and loads the latest N', async () => {
  const files = new Map();
  const fsFake = {
    async mkdir() {},
    async writeFile(p, s) { files.set(p, s); },
    async readdir() { return [...files.keys()].map((p) => p.split('/').pop()); },
    async readFile(p) { return files.get(p); },
  };
  const store = fileHistory('/snaps', fsFake);
  await store.save({ fetchedAt: '2026-10-01T10:00:00Z', assets: [{ symbol: 'A' }] });
  await store.save({ fetchedAt: '2026-10-02T10:00:00Z', assets: [{ symbol: 'B' }] });
  await store.save({ fetchedAt: '2026-10-03T10:00:00Z', assets: [{ symbol: 'C' }] });
  const last2 = await store.load(2);
  assert.deepEqual(last2.map((s) => s.day), ['2026-10-02', '2026-10-03']);
  assert.equal(last2[1].assets[0].symbol, 'C');
});

import { evaluateAlerts, marketChanges } from '../src/tools.js';

test('evaluateAlerts matches by symbol, chain, metric and operator with a TVL floor', () => {
  const alerts = [
    { id: 'a1', symbol: null, chain: null, metric: 'apy', operator: 'above', threshold: 3.9 },
    { id: 'a2', symbol: 'buidl', chain: 'solana', metric: 'tvl', operator: 'above', threshold: 900_000_000 },
    { id: 'a3', symbol: 'OUSG', chain: null, metric: 'apy', operator: 'below', threshold: 3 },
    { id: 'a4', symbol: null, chain: null, metric: 'apy', operator: 'above', threshold: 8 },
  ];
  const t = evaluateAlerts(market, alerts);
  assert.deepEqual(t.map((x) => x.alert.id), ['a1', 'a2']);
  assert.deepEqual(t[0].matches.map((m) => m.symbol), ['OUSG'], 'only OUSG is above 3.9 among treasuries; PST is other_rwa and TINY is under the floor');
  assert.equal(t[1].matches[0].chain, 'Solana');
});

test('marketChanges reports movers, new and gone deployments', () => {
  const older = buildMarket({ data: [
    { pool: 'p1', project: 'blackrock-buidl', chain: 'Ethereum', symbol: 'BUIDL', apy: 3.5, tvlUsd: 200_000_000, stablecoin: true },
    { pool: 'p2', project: 'blackrock-buidl', chain: 'Solana', symbol: 'BUIDL', apy: 3.78, tvlUsd: 900_000_000, stablecoin: true },
    { pool: 'p9', project: 'ondo-yield-assets', chain: 'Base', symbol: 'OUSG', apy: 4, tvlUsd: 5_000_000, stablecoin: true },
  ] }, protocols, '2026-10-08T00:00:00.000Z');
  const c = marketChanges(market, older);
  const eth = c.movers.find((m) => m.symbol === 'BUIDL' && m.chain === 'Ethereum');
  assert.equal(eth.apyChangePoints, 0.3);
  assert.equal(eth.tvlChangeUsd, 40_000_000);
  assert.equal(eth.tvlChangePercent, 20);
  assert.equal(c.movers.find((m) => m.symbol === 'OUSG' && m.chain === 'Ethereum').status, 'new');
  assert.equal(c.movers.find((m) => m.chain === 'Base').status, 'gone');
  assert.equal(c.totalTvlUsd.before, 1_105_000_000);
  assert.equal(c.totalTvlUsd.after, 1_224_000_000);
});

import { ISSUERS, issuerTerms, termsSummary } from '../src/issuers.js';

test('issuer records are complete and consistent', () => {
  for (const [sym, r] of Object.entries(ISSUERS)) {
    assert.equal(r.symbol, sym);
    for (const k of ['name', 'issuer', 'productType', 'underlying', 'eligibility', 'minimums', 'redemption', 'fees', 'confidence', 'sources']) assert.ok(k in r, `${sym} missing ${k}`);
    assert.ok(['issuer-docs', 'mixed'].includes(r.confidence), `${sym} confidence`);
    assert.ok(r.sources.length >= 1 && r.sources.every((u) => u.startsWith('https://')), `${sym} sources`);
    assert.ok(['allowed', 'excluded', null].includes(r.eligibility.usPersons) || typeof r.eligibility.usPersons === 'string');
  }
  assert.equal(issuerTerms('usyc').eligibility.usPersons, 'excluded');
  assert.equal(issuerTerms('NOPE').found, false);
  assert.equal(termsSummary('BUIDL').minimumInitialUsd, 5_000_000);
  assert.equal(getAsset(market, 'BUIDL').terms.eligibility, 'Qualified purchasers');
  assert.equal(getAsset(market, 'PST').terms, null);
});

import { PLANS, allowance, alertAllowance, limitMessage, KEY_TOOLS } from '../src/plans.js';

test('plans and allowances', () => {
  assert.equal(allowance('anonymous', 999).allowed, true);
  assert.equal(allowance('anonymous', 1000).allowed, false);
  assert.equal(allowance('free', 999).remaining, 1);
  assert.equal(allowance('pro', 0).limit, PLANS.pro.callsPerDay);
  assert.equal(allowance('bogus', 0).limit, PLANS.anonymous.callsPerDay, 'unknown tier falls back to anonymous');
  assert.equal(alertAllowance('anonymous', 0).allowed, false);
  assert.equal(alertAllowance('free', 2).allowed, true);
  assert.equal(alertAllowance('free', 3).allowed, false);
  assert.match(limitMessage('calls', 'anonymous'), /create_api_key/);
  assert.match(limitMessage('calls', 'free'), /upgrade/);
  assert.match(limitMessage('alerts', 'anonymous'), /API key/);
  assert.ok(KEY_TOOLS.has('create_alert') && !KEY_TOOLS.has('list_rwa_yields'));
});

import { applyStripeEvent, tierForSubscriptionEvent } from '../src/billing.js';

function fakeDb() {
  const updates = [];
  const db = { from: (table) => ({ update: (patch) => ({ eq: async (col, val) => { updates.push({ table, patch, where: [col, val] }); return { data: null, error: null }; } }) }) };
  return { db, updates };
}

test('stripe: checkout completion upgrades the referenced key to pro', async () => {
  const { db, updates } = fakeDb();
  const r = await applyStripeEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'key-1', customer: 'cus_1', subscription: 'sub_1' } } }, db);
  assert.equal(r.action, 'upgraded');
  assert.deepEqual(updates, [{ table: 'api_keys', patch: { tier: 'pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }, where: ['id', 'key-1'] }]);
});

test('stripe: subscription deleted drops the key to free', async () => {
  const { db, updates } = fakeDb();
  const r = await applyStripeEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } }, db);
  assert.equal(r.action, 'downgraded');
  assert.deepEqual(updates, [{ table: 'api_keys', patch: { tier: 'free' }, where: ['stripe_subscription_id', 'sub_1'] }]);
});

test('stripe: subscription updated keeps pro while active, drops otherwise; unknown events ignored', async () => {
  assert.equal(tierForSubscriptionEvent('customer.subscription.updated', 'active'), 'pro');
  assert.equal(tierForSubscriptionEvent('customer.subscription.updated', 'past_due'), 'pro');
  assert.equal(tierForSubscriptionEvent('customer.subscription.updated', 'unpaid'), 'free');
  assert.equal(tierForSubscriptionEvent('customer.subscription.deleted', 'active'), 'free');
  assert.equal(tierForSubscriptionEvent('invoice.paid', 'active'), null);
  const { db, updates } = fakeDb();
  const r = await applyStripeEvent({ type: 'invoice.paid', data: { object: {} } }, db);
  assert.equal(r.action, 'ignored');
  assert.equal(updates.length, 0);
});

import Stripe from 'stripe';
import { handleStripeWebhook } from '../src/billing.js';

test('stripe webhook: forged or missing signatures are rejected and nothing is written', async () => {
  const stripe = new Stripe('sk_test_dummy', { apiVersion: '2025-02-24.acacia' });
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } });

  const forged = fakeDb();
  const r1 = await handleStripeWebhook({ stripe, rawBody: payload, signature: 't=1,v1=deadbeef', secret, db: forged.db });
  assert.equal(r1.status, 400);
  assert.equal(forged.updates.length, 0);

  const missing = fakeDb();
  const r2 = await handleStripeWebhook({ stripe, rawBody: payload, signature: null, secret, db: missing.db });
  assert.equal(r2.status, 400);
  assert.equal(missing.updates.length, 0);

  const wrongSecret = fakeDb();
  const sigOther = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_someone_else' });
  const r3 = await handleStripeWebhook({ stripe, rawBody: payload, signature: sigOther, secret, db: wrongSecret.db });
  assert.equal(r3.status, 400);
  assert.equal(wrongSecret.updates.length, 0);

  const tampered = fakeDb();
  const sigGood = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const r4 = await handleStripeWebhook({ stripe, rawBody: payload.replace('sub_1', 'sub_2'), signature: sigGood, secret, db: tampered.db });
  assert.equal(r4.status, 400);
  assert.equal(tampered.updates.length, 0);

  const genuine = fakeDb();
  const r5 = await handleStripeWebhook({ stripe, rawBody: payload, signature: sigGood, secret, db: genuine.db });
  assert.equal(r5.status, 200);
  assert.equal(r5.body.action, 'downgraded');
  assert.deepEqual(genuine.updates[0].patch, { tier: 'free' });

  const unconfigured = await handleStripeWebhook({ stripe, rawBody: payload, signature: sigGood, secret: undefined, db: fakeDb().db });
  assert.equal(unconfigured.status, 503);
});

import { listStables, stablecoinSummary } from '../src/tools.js';
import { buildStables, CATEGORY_GROUPS } from '../src/data.js';

const stableProtocols = [
  ...protocols,
  { slug: 'aave-v3', category: 'Lending' },
  { slug: 'morpho-blue', category: 'Lending' },
  { slug: 'accountable', category: 'Uncollateralized Lending' },
  { slug: 'ethena', category: 'Basis Trading' },
  { slug: 'yearn', category: 'Yield Aggregator' },
];
const stablePools = {
  data: [
    ...pools.data,
    { pool: 's1', project: 'aave-v3', chain: 'Ethereum', symbol: 'USDC', apy: 4.1, apyBase: 4.1, apyReward: 0, apyMean30d: 4.0, tvlUsd: 900_000_000, stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false },
    { pool: 's2', project: 'morpho-blue', chain: 'Base', symbol: 'USDC', apy: 6.5, apyBase: 5.0, apyReward: 1.5, apyMean30d: 6.2, tvlUsd: 50_000_000, stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false },
    { pool: 's3', project: 'accountable', chain: 'Ethereum', symbol: 'USDC', apy: 12.1, apyBase: 12.1, apyReward: 0, apyMean30d: 12.4, tvlUsd: 11_000_000, stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false },
    { pool: 's4', project: 'ethena', chain: 'Ethereum', symbol: 'SUSDE', apy: 7.2, apyBase: 7.2, apyReward: 0, apyMean30d: 8.0, tvlUsd: 2_000_000_000, stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false },
    { pool: 's5', project: 'aave-v3', chain: 'Ethereum', symbol: 'USDT', apy: 3.9, apyBase: 3.9, apyReward: 0, apyMean30d: 3.8, tvlUsd: 700_000_000, stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false },
    { pool: 'x1', project: 'aave-v3', chain: 'Ethereum', symbol: 'USDC-USDT', apy: 9, tvlUsd: 100_000_000, stablecoin: true, exposure: 'multi', ilRisk: 'yes', outlier: false },
    { pool: 'x2', project: 'yearn', chain: 'Ethereum', symbol: 'USDC', apy: 99, tvlUsd: 20_000_000, stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: true },
    { pool: 'x3', project: 'yearn', chain: 'Ethereum', symbol: 'DAI', apy: 5, tvlUsd: 500_000, stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false },
    { pool: 'x4', project: 'blackrock-buidl', chain: 'Ethereum', symbol: 'BUIDL', apy: 3.8, tvlUsd: 240_000_000, stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false },
  ],
};
const smarket = buildMarket(stablePools, stableProtocols, '2026-10-09T00:00:00.000Z');

test('buildStables keeps single-asset, non-outlier, non-RWA stablecoin pools above $1M and groups categories', () => {
  assert.deepEqual(smarket.stables.map((p) => p.poolId).sort(), ['s1', 's2', 's3', 's4', 's5']);
  const byId = Object.fromEntries(smarket.stables.map((p) => [p.poolId, p]));
  assert.equal(byId.s1.group, 'lending');
  assert.equal(byId.s3.group, 'credit');
  assert.equal(byId.s4.group, 'basis');
  assert.equal(byId.s2.apyRewardPercent, 1.5);
  assert.equal(byId.s1.major, true);
  assert.equal(byId.s4.major, false);
  assert.equal(CATEGORY_GROUPS['Yield Aggregator'], 'vault');
  assert.equal(smarket.assets.length, 6, 'rwa assets unaffected (BUIDL x3 incl. x4, OUSG, TINY... see fixture)');
});

test('listStables filters and sorts with a $10M default floor', () => {
  const all = listStables(smarket);
  assert.deepEqual(all.pools.map((p) => p.poolId), ['s3', 's4', 's2', 's1', 's5'], 'apy desc');
  assert.deepEqual(listStables(smarket, { group: 'lending' }).pools.map((p) => p.poolId), ['s2', 's1', 's5']);
  assert.deepEqual(listStables(smarket, { symbol: 'usdc', chain: 'base' }).pools.map((p) => p.poolId), ['s2']);
  assert.deepEqual(listStables(smarket, { majorOnly: true, sortBy: 'tvlUsd', limit: 2 }).pools.map((p) => p.poolId), ['s1', 's5']);
  assert.ok(all.groups.credit.includes('higher risk'));
});

test('stablecoinSummary aggregates per symbol and group with a treasury comparison', () => {
  const s = stablecoinSummary(smarket);
  const usdc = s.stablecoins.find((x) => x.symbol === 'USDC');
  assert.equal(usdc.venues, 3);
  assert.equal(usdc.totalTvlUsd, 961_000_000);
  assert.equal(usdc.medianApyPercent, 6.5);
  assert.equal(usdc.bestAnyGroup.group, 'credit');
  assert.equal(usdc.bestLending.project, 'morpho-blue');
  assert.equal(s.byGroup.lending.pools, 3);
  assert.equal(s.totals.pools, 5);
  assert.equal(s.tokenizedTreasuryMedianApyPercent, 3.8, 'median of 3.8, 3.78, 4.0, 3.8');
});

test('history, changes and alerts accept the stablecoin universe', () => {
  const snaps = [{ day: '2026-10-08', stables: [{ symbol: 'USDC', chain: 'Ethereum', project: 'aave-v3', apyPercent: 4.5, tvlUsd: 800_000_000 }], assets: [] }, { day: '2026-10-09', stables: smarket.stables, assets: smarket.assets }];
  const h = historySeries(snaps, { symbol: 'USDC', chain: 'Ethereum', universe: 'stablecoin' });
  assert.equal(h.universe, 'stablecoin');
  assert.equal(h.series[1].totalTvlUsd, 911_000_000);
  const none = historySeries(snaps, { symbol: 'USDC', universe: 'rwa' });
  assert.equal(none.series[1].deployments, 0, 'USDC is not in the rwa universe');
  const c = marketChanges(smarket, { fetchedAt: '2026-10-08', assets: [], stables: snaps[0].stables }, { universe: 'stablecoin' });
  assert.equal(c.universe, 'stablecoin');
  assert.ok(c.movers.some((m) => m.project === 'aave-v3' && m.status === 'changed'));
  const t = evaluateAlerts(smarket, [
    { id: 'u1', universe: 'stablecoin', symbol: null, metric: 'apy', operator: 'above', threshold: 6, minTvlUsd: 10_000_000 },
    { id: 'u2', universe: 'stablecoin', symbol: 'USDT', metric: 'apy', operator: 'below', threshold: 4, minTvlUsd: 10_000_000 },
    { id: 'u3', universe: 'rwa', symbol: null, metric: 'apy', operator: 'above', threshold: 6 },
  ]);
  assert.deepEqual(t.map((x) => x.alert.id), ['u1', 'u2']);
  assert.deepEqual(t[0].matches.map((m) => m.poolId), ['s2', 's3'], 'major stablecoins only: SUSDE excluded');
});

import { clampDays, stableAccess, trimIssuerTerms, UPGRADE_NOTE } from '../src/plans.js';
import { createServer } from '../src/mcp.js';

test('depth gating: days, stablecoin groups and issuer terms follow the plan', () => {
  assert.deepEqual(clampDays(PLANS.free, 30, 'history'), { days: 7, limited: true, max: 7 });
  assert.deepEqual(clampDays(PLANS.pro, 30, 'history'), { days: 30, limited: false });
  assert.deepEqual(clampDays(null, 400, 'changes'), { days: 400, limited: false }, 'self-hosted is unlimited');
  assert.equal(clampDays(PLANS.anonymous, 3, 'changes').days, 1);
  const a = stableAccess(PLANS.free, { group: 'credit', limit: 50 });
  assert.equal(a.deniedGroup, 'credit');
  const b = stableAccess(PLANS.free, { group: undefined, limit: 50 });
  assert.equal(b.limit, 10); assert.deepEqual(b.groups, ['lending', 'vault']); assert.equal(b.limited, true);
  const c = stableAccess(PLANS.pro, { group: 'basis', limit: 50 });
  assert.equal(c.deniedGroup, null); assert.equal(c.limit, 50);
  const full = issuerTerms('USYC');
  const trimmed = trimIssuerTerms(PLANS.free, full);
  assert.equal(trimmed.summaryOnly, true);
  assert.equal(trimmed.eligibility.usPersons, 'excluded');
  assert.equal(trimmed.minimums.initialUsd, 100_000);
  assert.equal('fees' in trimmed, false);
  assert.equal(trimIssuerTerms(PLANS.pro, full).fees.performance, '10% of yield');
  assert.equal(trimIssuerTerms(PLANS.free, issuerTerms('NOPE')).found, false);
  assert.match(UPGRADE_NOTE, /upgrade/);
});

test('createServer applies the plan to list_stablecoin_yields, rwa_history and rwa_changes', async () => {
  const snaps = [
    { day: '2026-10-01', assets: [], stables: [] }, { day: '2026-10-05', assets: [], stables: [] },
    { day: '2026-10-09', assets: smarket.assets, stables: smarket.stables },
  ];
  const mk = (plan) => createServer({ loadMarket: async () => smarket, history: { load: async (d) => snaps.slice(-d) }, plan });
  const call = async (server, name, args) => JSON.parse((await server._registeredTools[name].handler(args, {})).content[0].text);
  const free = mk(PLANS.free);
  const l = await call(free, 'list_stablecoin_yields', { minTvlUsd: 1 });
  assert.ok(l.pools.every((p) => ['lending', 'vault'].includes(p.group)), 'credit and basis hidden on Free');
  assert.match(l.planNote, /Pro/);
  const d = await call(free, 'list_stablecoin_yields', { group: 'credit' });
  assert.equal(d.deniedGroup, 'credit');
  const h = await call(free, 'rwa_history', { symbol: 'USDC', universe: 'stablecoin', days: 30 });
  assert.equal(h.days, 3, 'the store returned the three snapshots inside the 7-day cap, none beyond it');
  assert.match(h.planNote, /7 days/);
  const pro = mk(PLANS.pro);
  const lp = await call(pro, 'list_stablecoin_yields', { minTvlUsd: 1 });
  assert.ok(lp.pools.some((p) => p.group === 'credit'));
  assert.equal(lp.planNote, undefined);
  const t = await call(pro, 'rwa_issuer_terms', { symbol: 'BUIDL' });
  assert.equal(t.summaryOnly, undefined);
  const selfHosted = mk(null);
  const lh = await call(selfHosted, 'list_stablecoin_yields', { minTvlUsd: 1, limit: 100 });
  assert.equal(lh.planNote, undefined);
});

import { parseEquity, buildEquities, listEquities, getEquity, equitySummary } from '../src/equities.js';

const cgStock = [
  { id: 'tesla-xstock', symbol: 'tslax', name: 'Tesla xStock', current_price: 382, market_cap: 72_000_000, total_volume: 2_000_000, price_change_percentage_24h: 1.234 },
  { id: 'tesla-bstock', symbol: 'tslab', name: 'Tesla (bStocks Tokenized Stock)', current_price: 379, market_cap: 22_000_000, total_volume: 1_300_000, price_change_percentage_24h: -0.5 },
  { id: 'nvidia-ondo', symbol: 'nvdaon', name: 'NVIDIA (Ondo Tokenized Stock)', current_price: 230.66, market_cap: 35_000_000, total_volume: 820_000, price_change_percentage_24h: 0 },
  { id: 'spacex-xstock', symbol: 'spcxx', name: 'SpaceX xStock', current_price: 163, market_cap: 47_000_000, total_volume: 6_000_000, price_change_percentage_24h: 2 },
  { id: 'tiny', symbol: 'tiny', name: 'Tiny Thing (Robinhood)', current_price: 1, market_cap: 10_000, total_volume: 1, price_change_percentage_24h: 0 },
  { id: 'tesla-xstock', symbol: 'tslax', name: 'duplicate', current_price: 1, market_cap: 1, total_volume: 1 },
];
const cgEtf = [{ id: 'spy-xstock', symbol: 'spyx', name: 'SPDR S&P 500 xStock', current_price: 600, market_cap: 5_000_000, total_volume: 100_000, price_change_percentage_24h: 0.1 }];
const quotes = { TSLA: { price: 375, asOf: '2026-10-10T20:00:00.000Z' }, NVDA: { price: 230.66, asOf: '2026-10-10T20:00:00.000Z' } };
const meta = { 'tesla-xstock': { chains: ['solana', 'ethereum'] } };
const emarket = { fetchedAt: '2026-10-11T00:00:00.000Z', assets: [], stables: [], equities: buildEquities({ stock: [cgStock], etf: [cgEtf] }, { quotes, meta }) };

test('parseEquity detects issuers and underlyings from CoinGecko names', () => {
  assert.equal(parseEquity(cgStock[0], 'stock').issuer, 'xStocks (Backed)');
  assert.equal(parseEquity(cgStock[0], 'stock').underlying, 'TSLA');
  assert.equal(parseEquity(cgStock[1], 'stock').issuer, 'bStocks');
  assert.equal(parseEquity(cgStock[1], 'stock').underlying, 'TSLA');
  assert.equal(parseEquity(cgStock[2], 'stock').issuer, 'Ondo Global Markets');
  assert.equal(parseEquity(cgStock[2], 'stock').underlying, 'NVDA');
  assert.equal(parseEquity({ symbol: 'zzz', name: 'Unknown Corp Token' }, 'stock').issuer, 'other');
  assert.equal(parseEquity({ symbol: 'zzz', name: 'Unknown Corp Token' }, 'stock').underlying, null);
});

test('buildEquities dedupes, attaches quotes, premium and chains, sorts by market cap', () => {
  const e = emarket.equities;
  assert.equal(e.length, 6, 'duplicate id dropped');
  assert.equal(e[0].symbol, 'TSLAX');
  assert.equal(e[0].premiumPercent, 1.87, '(382-375)/375');
  assert.deepEqual(e[0].chains, ['solana', 'ethereum']);
  assert.equal(e.find((x) => x.symbol === 'NVDAON').premiumPercent, 0);
  assert.equal(e.find((x) => x.symbol === 'SPCXX').premiumPercent, null, 'no quote for a private company');
  assert.equal(e.find((x) => x.symbol === 'SPYX').kind, 'etf');
});

test('listEquities, getEquity and equitySummary', () => {
  assert.deepEqual(listEquities(emarket, { underlying: 'tsla' }).equities.map((x) => x.symbol), ['TSLAX', 'TSLAB']);
  assert.deepEqual(listEquities(emarket, { chain: 'Solana' }).equities.map((x) => x.symbol), ['TSLAX']);
  assert.equal(listEquities(emarket).matched, 5, 'default $1M floor drops the tiny one');
  assert.equal(listEquities(emarket, { sortBy: 'premium', limit: 1 }).equities[0].symbol, 'TSLAX');
  const g = getEquity(emarket, 'TSLA');
  assert.equal(g.wrappers, 2);
  assert.deepEqual(g.issuers, ['xStocks (Backed)', 'bStocks']);
  assert.equal(g.mostLiquid, 'TSLAX');
  assert.deepEqual(g.premiumRangePercent, { min: 1.07, max: 1.87 });
  assert.equal(getEquity(emarket, 'AAPL').found, false);
  const s = equitySummary(emarket);
  assert.equal(s.totals.tokens, 6);
  assert.equal(s.byIssuer['xStocks (Backed)'].tokens, 3);
  assert.equal(s.byKind.etf.tokens, 1);
  assert.equal(s.topUnderlyings[0].underlying, 'TSLA');
  assert.equal(s.premium.tokensWithQuote, 3);
});
