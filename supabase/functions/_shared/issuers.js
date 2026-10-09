// Hand-curated issuer terms for the main tokenized treasury tokens.
// confidence: 'issuer-docs' = taken from the issuer's own pages on verifiedOn; 'mixed' = some fields from third parties.
// Anything not found is null. Re-verify before relying on a figure; terms change without notice.
export const VERIFIED_ON = '2026-10-09';
export const DISCLAIMER_NOTE = 'Curated from public issuer and third-party pages on the verifiedOn date. Terms change without notice. Confirm with the issuer before acting. Information only, not advice.';

export const ISSUERS = {
  BUIDL: {
    symbol: 'BUIDL', name: 'BlackRock USD Institutional Digital Liquidity Fund', issuer: 'BlackRock', platform: 'Securitize (tokenization platform, transfer agent, placement agent)',
    productType: 'Private fund; shares offered under Rule 506(c) / Section 3(c)(7)', underlying: 'Cash, US Treasury bills and repurchase agreements', domicile: null,
    eligibility: { investorType: 'Qualified purchasers', usPersons: 'allowed', kyc: 'Securitize KYC/KYB and accreditation review; transfers restricted to whitelisted wallets' },
    minimums: { initialUsd: 5_000_000, subsequentUsd: null, redemptionUsd: null },
    redemption: { method: 'Off-chain wire via Securitize; a USDC redemption facility operated by Circle has been publicly announced', timing: null },
    fees: { management: '0.20%–0.50% depending on share class/network (third-party figure)', subscription: null, redemption: null, performance: '0%' },
    yieldMechanics: 'Accrues daily; distributed monthly as newly minted BUIDL tokens', custodian: 'BNY Mellon (custodian and administrator)',
    confidence: 'mixed',
    sources: ['https://securitize.io/learn/press/blackrock-launches-first-tokenized-fund-buidl-on-the-ethereum-network', 'https://app.rwa.xyz/assets/BUIDL', 'https://eco.com/support/en/articles/15254013-buidl-deep-dive-2026'],
  },
  USYC: {
    symbol: 'USYC', name: 'Hashnote International Short Duration Fund Ltd. (USYC token)', issuer: 'Circle (Hashnote, acquired January 2025)', platform: 'Circle International Bermuda Limited (token administrator, BMA-licensed)',
    productType: 'Cayman Islands registered mutual fund; each token is a share', underlying: 'Short-term US government securities and reverse repurchase agreements', domicile: 'Cayman Islands',
    eligibility: { investorType: 'Non-U.S. Persons only (Securities Act of 1933 definition); "additional eligibility restrictions may apply"', usPersons: 'excluded', kyc: 'Onboarding with Circle; on-chain entitlements contract enforces permissions' },
    minimums: { initialUsd: 100_000, subsequentUsd: null, redemptionUsd: null },
    redemption: { method: 'USDC, on-chain', timing: 'Instant (one block) below the instant-redemption capacity; T+0 or T+1 above it; unlimited instant redemption available for a fee' },
    fees: { management: null, subscription: '0.04% (0% on first $1M combined daily volume)', redemption: '0.03% (0% on first $1M combined daily volume)', performance: '10% of yield' },
    yieldMechanics: 'Accrues through a rising token price; NAV published on-chain daily', custodian: null,
    confidence: 'issuer-docs', sources: ['https://www.circle.com/en/usyc'],
  },
  USDY: {
    symbol: 'USDY', name: 'Ondo US Dollar Yield', issuer: 'Ondo Finance (Ondo USDY LLC)', platform: 'Ondo',
    productType: 'Tokenized note', underlying: 'Short-term US Treasuries, shares of the iShares Short Treasury Bond ETF, and/or bank demand deposits (varies by issuance)', domicile: 'United States (issuer LLC); USDC redemptions via Ondo Global Markets (BVI) Limited',
    eligibility: { investorType: 'Qualifying non-US individual and institutional investors', usPersons: 'excluded', kyc: 'Onboarding required' },
    minimums: { initialUsd: null, subsequentUsd: null, redemptionUsd: null, notes: 'Bank wires for $100K+; $5,000 minimum to mint/redeem on Sui, Aptos, Stellar, XRP Ledger or Noble' },
    redemption: { method: 'USD by wire to a non-US bank account, or USDC via the Ondo web app', timing: null },
    fees: { management: null, subscription: null, redemption: null, performance: null },
    yieldMechanics: 'USDY: rising token price, updated each business day. rUSDY: rebasing variant pegged to $1.00', custodian: null,
    confidence: 'issuer-docs', sources: ['https://docs.ondo.finance/general-access-products/usdy/basics'],
  },
  OUSG: {
    symbol: 'OUSG', name: 'Ondo Short-Term US Government Treasuries', issuer: 'Ondo Finance', platform: 'Ondo',
    productType: 'Qualified-access fund share class', underlying: 'Short-term US Treasuries and GSE securities, mainly via funds from BlackRock, Franklin Templeton, WisdomTree, Fidelity and others, plus bank deposits and USDC for liquidity', domicile: null,
    eligibility: { investorType: 'Investors eligible for Ondo Qualified Access Funds (third parties report qualified purchaser status)', usPersons: 'see Ondo eligibility page', kyc: 'Onboarding required' },
    minimums: { initialUsd: 5_000, subsequentUsd: null, redemptionUsd: 5_000, notes: 'Instant subscribe/redeem: $5,000. Non-instant: $100,000 subscribe, $50,000 redeem' },
    redemption: { method: 'Instant USDC redemption 24/7/365 up to published daily limits; larger amounts via non-instant request', timing: 'Instant within limits' },
    fees: { management: '0.15%, waived until 1 January 2027', subscription: null, redemption: null, performance: null },
    yieldMechanics: 'Returns through NAV; NAV per token updated at end of each business day and pushed to an on-chain oracle', custodian: null,
    confidence: 'issuer-docs', sources: ['https://docs.ondo.finance/qualified-access-products/ousg/overview'],
  },
  USTB: {
    symbol: 'USTB', name: 'Invesco Short Duration US Government Securities Fund (formerly Superstate Short Duration US Government Securities Fund)', issuer: 'Invesco Advisers (investment manager); Superstate (on-chain issuance, settlement, transfer agent)', platform: 'Superstate',
    productType: 'Tokenized private fund', underlying: 'Short-duration US Treasury bills', domicile: null,
    eligibility: { investorType: 'Accredited Investors and Qualified Purchasers (issuer page)', usPersons: 'allowed', kyc: 'Identity verification and investor certification during onboarding' },
    minimums: { initialUsd: 100_000, subsequentUsd: null, redemptionUsd: null, notes: 'Minimum is a third-party figure (100,000 USDC)' },
    redemption: { method: 'USD or USDC (USDC leg via Circle)', timing: 'Liquidity each market day; redemptions can be priced in real time' },
    fees: { management: '≤ 0.15%', subscription: null, redemption: '0% (third-party figure)', performance: '0% (third-party figure)' },
    yieldMechanics: 'Interest accrues in real time from subscription; NAV-based', custodian: null,
    confidence: 'mixed', sources: ['https://superstate.com/ustb', 'https://www.nasdaq.com/press-release/invesco-and-superstate-advance-institutional-tokenization-through-ustb-partnership', 'https://app.rwa.xyz/assets/USTB'],
  },
  TBILL: {
    symbol: 'TBILL', name: 'OpenEden TBILL', issuer: 'OpenEden', platform: 'OpenEden',
    productType: 'Permissioned tokenized vault', underlying: 'US Treasury bills and USD, backed 1:1; T-bills held in segregated accounts', domicile: null,
    eligibility: { investorType: 'Accredited or Professional Investors', usPersons: null, kyc: 'Fund KYC screening; wallet whitelisting; transfers only between whitelisted investors' },
    minimums: { initialUsd: 100_000, subsequentUsd: 1, redemptionUsd: null },
    redemption: { method: 'USDC via redemption queue', timing: 'Typically processed on the next US business day' },
    fees: { management: null, subscription: null, redemption: '5 bps per redemption', performance: null, expenseRatio: '30 bps annualized total expense ratio' },
    yieldMechanics: null, custodian: 'BNY (US T-bills); administrator Protege Fund Services; legal counsel Harneys',
    confidence: 'issuer-docs', sources: ['https://docs.openeden.com/tbill/faq'],
  },
  STBT: {
    symbol: 'STBT', name: 'Matrixdock Short-term Treasury Bill Token', issuer: 'Matrixdock (issuer entity reported as Prometheus Solutions Ltd., Seychelles)', platform: 'Matrixdock',
    productType: 'Rebasing token; 1 STBT = $1.00 NAV of short-term US Treasuries', underlying: 'Short-term US Treasury bills and reverse repurchase agreements', domicile: 'Seychelles (third-party figure)',
    eligibility: { investorType: 'Accredited Investors only', usPersons: null, kyc: 'KYC and accredited-investor checks; whitelist controls on mint, hold, transfer and redeem' },
    minimums: { initialUsd: null, subsequentUsd: null, redemptionUsd: null },
    redemption: { method: 'Via Matrixdock or OTC; secondary liquidity through a permissioned Curve pool', timing: 'Daily (third-party figure)' },
    fees: { management: '0.30% (third-party figure)', subscription: '0% (third-party figure)', redemption: '0% (third-party figure)', performance: null },
    yieldMechanics: 'Daily interest via on-chain rebasing', custodian: null,
    confidence: 'mixed', sources: ['https://www.matrixdock.com/stbt', 'https://app.rwa.xyz/assets/STBT'],
  },
  BENJI: {
    symbol: 'BENJI', name: 'Franklin OnChain U.S. Government Money Fund (FOBXX)', issuer: 'Franklin Templeton', platform: 'Benji',
    productType: 'US-registered money market fund; 1 share of FOBXX = 1 BENJI token', underlying: 'US government securities (money market fund)', domicile: 'United States',
    eligibility: { investorType: 'Retail via the Benji app (Stellar) and institutions via the web platform', usPersons: 'allowed', kyc: 'Account onboarding with the fund transfer agent' },
    minimums: { initialUsd: null, subsequentUsd: null, redemptionUsd: null },
    redemption: { method: 'Through the Benji platform; USDC conversions enabled since June 2024', timing: null },
    fees: { management: null, subscription: null, redemption: null, performance: null },
    yieldMechanics: 'Stable $1.00 NAV; yield accrues daily and is paid as newly minted BENJI tokens', custodian: null,
    chainsNote: 'Stellar for retail and institutions; Polygon, Arbitrum, Avalanche, Aptos, Ethereum, Base, Solana, BNB Smart Chain institutional only',
    confidence: 'issuer-docs', sources: ['https://digitalassets.franklintempleton.com/benji/'],
  },
};

export function issuerTerms(symbol) {
  const s = String(symbol ?? '').toUpperCase();
  const rec = ISSUERS[s];
  if (!rec) return { symbol: s, found: false, hint: `No curated terms yet. Covered: ${Object.keys(ISSUERS).join(', ')}.` };
  return { found: true, verifiedOn: VERIFIED_ON, ...rec };
}

export function termsSummary(symbol) {
  const rec = ISSUERS[String(symbol ?? '').toUpperCase()];
  if (!rec) return null;
  return { eligibility: rec.eligibility.investorType, usPersons: rec.eligibility.usPersons, minimumInitialUsd: rec.minimums.initialUsd, fees: rec.fees, redemption: rec.redemption.method, verifiedOn: VERIFIED_ON, confidence: rec.confidence };
}
