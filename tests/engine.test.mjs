import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  analyze,
  build,
  simulate,
  validate,
  client,
  units,
} from "../engine.mjs";
test("SDK curves have correct human-unit start price and monotonic prices", () => {
  for (const c of analyze(defaults)) {
    assert.ok(
      Math.abs(c.startPrice - defaults.initialMarketCap / defaults.supply) <
        1e-15,
    );
    assert.ok(c.threshold > 0);
    for (let i = 1; i < c.points.length; i++)
      assert.ok(c.points[i].price >= c.points[i - 1].price);
    assert.ok(c.points.at(-1).price <= c.endPrice);
  }
});
test("different liquidity distributions produce distinct graduation thresholds", () => {
  assert.equal(new Set(analyze(defaults).map((c) => c.threshold)).size, 3);
});
test("first simulated trade matches SDK pre-launch quote exactly", () => {
  const c = build(defaults),
    q = client.pool.getQuoteFromInputAmount({
      config: c,
      swapBaseForQuote: false,
      amountIn: units(1),
      slippageBps: 100,
    });
  const result = simulate(defaults, "balanced", [{ side: "buy", amount: 1 }]);
  assert.equal(result.rows[0].output, Number(q.outputAmount.toString()) / 1e6);
  assert.equal(result.reserve, 0.99);
  assert.equal(result.fees, 0.01);
  assert.ok(result.rows[0].minimum < result.rows[0].output);
});
test("round trip loses fees and does not create quote liquidity", () => {
  const buy = simulate(defaults, "balanced", [{ side: "buy", amount: 1 }]);
  const result = simulate(defaults, "balanced", [
    { side: "buy", amount: 1 },
    { side: "sell", amount: buy.held },
  ]);
  assert.equal(result.held, 0);
  assert.ok(result.rows[1].output < 1);
  assert.ok(Math.abs(result.reserve) < 1e-6);
});
test("sequential buys increase price and conserved holdings reflect sells", () => {
  const r = simulate(defaults, "patient", [
    { side: "buy", amount: 1 },
    { side: "buy", amount: 2 },
    { side: "sell", amount: 1000 },
  ]);
  assert.ok(r.rows[1].price > r.rows[0].price);
  assert.ok(r.rows[2].price < r.rows[1].price);
  assert.ok(
    Math.abs(r.held - (r.rows[0].output + r.rows[1].output - 1000)) < 1e-6,
  );
});
test("invalid config, oversized buys and selling unowned tokens are rejected", () => {
  assert.throws(() => validate({ ...defaults, feeBps: NaN }));
  assert.throws(() => validate({ ...defaults, migrationMarketCap: 20 }));
  assert.throws(() =>
    simulate(defaults, "balanced", [{ side: "sell", amount: 1 }]),
  );
  assert.throws(() =>
    simulate(defaults, "balanced", [{ side: "buy", amount: 1000 }]),
  );
  assert.throws(() => build(defaults, "fake"));
});
