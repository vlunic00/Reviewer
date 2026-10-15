const assert = require('node:assert/strict');
const { join } = require('node:path');
const { CatalogCache } = require(join(process.argv[2], 'src/catalog-cache.js'));
const { offer } = require(join(process.argv[2], 'src/offers.js'));
const after = process.argv[3] === 'after';

(async () => {
  let calls = 0;
  const cache = new CatalogCache({
    load: async (tenant, sku) => {
      calls++;
      return { sku, priceCents: tenant === 'red' ? 100 : 250 };
    },
  });
  assert.equal((await cache.get('red', 'pen')).priceCents, 100);
  assert.equal(
    (await cache.get('blue', 'pen')).priceCents,
    after ? 100 : 250,
    'issue-001: tenant identity',
  );
  assert.equal(calls, after ? 1 : 2);

  let attempts = 0;
  const recovering = new CatalogCache({
    load: async (_tenant, sku) => {
      if (++attempts === 1) throw new Error('temporary outage');
      return { sku, priceCents: 100 };
    },
  });
  await assert.rejects(recovering.get('red', 'pen'), /temporary outage/);
  if (after)
    await assert.rejects(recovering.get('red', 'pen'), /temporary outage/);
  else assert.equal((await recovering.get('red', 'pen')).priceCents, 100);
  assert.equal(
    attempts,
    after ? 1 : 2,
    'issue-002: rejected entries must be evicted',
  );

  const base = new CatalogCache({
    load: async (_tenant, sku) => ({ sku, priceCents: 100 }),
  });
  assert.equal((await offer(base, 'red', 'pen', 10)).priceCents, 90);
  assert.equal(
    (await base.get('red', 'pen')).priceCents,
    after ? 90 : 100,
    'issue-003: caller isolation',
  );
  let coalesced = 0;
  const shared = new CatalogCache({
    load: async (_tenant, sku) => {
      coalesced++;
      return { sku, priceCents: 100 };
    },
  });
  const [first, second] = await Promise.all([
    shared.get('red', 'pen'),
    shared.get('red', 'pen'),
  ]);
  assert.equal(coalesced, 1, 'preserve same-tenant coalescing');
  assert.equal(first === second, after, 'callers receive distinct copies');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
