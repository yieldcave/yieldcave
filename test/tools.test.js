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
  assert.equal(allowance('anonymous', 199).allowed, true);
  assert.equal(allowance('anonymous', 200).allowed, false);
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
