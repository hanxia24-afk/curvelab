import * as sdk from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection } from "@solana/web3.js";
import BN from "bn.js";
export const defaults = {
  supply: 1000000000,
  initialMarketCap: 30,
  migrationMarketCap: 300,
  feeBps: 100,
  slippageBps: 100,
};
export const presets = [
  {
    id: "balanced",
    name: "Balanced",
    description: "Equal liquidity across price ranges",
    color: "#b1ef68",
    weights: Array(16).fill(1),
  },
  {
    id: "patient",
    name: "Patient launch",
    description: "More liquidity at early prices",
    color: "#79bdff",
    weights: Array.from({ length: 16 }, (_, i) => 1.16 ** (15 - i)),
  },
  {
    id: "momentum",
    name: "Momentum",
    description: "More liquidity near graduation",
    color: "#ffad79",
    weights: Array.from({ length: 16 }, (_, i) => 1.16 ** i),
  },
];
export function validate(input) {
  const p = { ...defaults, ...input };
  for (const k of Object.keys(defaults))
    if (typeof p[k] !== "number" || !Number.isFinite(p[k]))
      throw Error(`${k} must be a finite number`);
  if (p.supply < 1000 || p.supply > 1e12 || !Number.isInteger(p.supply))
    throw Error("Supply must be an integer between 1,000 and 1 trillion");
  if (
    p.initialMarketCap <= 0 ||
    p.migrationMarketCap <= p.initialMarketCap ||
    p.migrationMarketCap > 1e8
  )
    throw Error(
      "Graduation market cap must exceed initial market cap (maximum 100M SOL)",
    );
  if (!Number.isInteger(p.feeBps) || p.feeBps < 25 || p.feeBps > 1000)
    throw Error("Fee must be 25–1000 bps");
  if (
    !Number.isInteger(p.slippageBps) ||
    p.slippageBps < 0 ||
    p.slippageBps > 1000
  )
    throw Error("Slippage must be 0–1000 bps");
  return p;
}
export function build(input, id = "balanced") {
  const p = validate(input),
    preset = presets.find((x) => x.id === id);
  if (!preset) throw Error("Unknown preset");
  return sdk.buildCurveWithLiquidityWeights({
    token: {
      tokenType: 0,
      tokenBaseDecimal: 6,
      tokenQuoteDecimal: 9,
      tokenAuthorityOption: 1,
      totalTokenSupply: p.supply,
      leftover: p.supply * 0.01,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: 0,
        feeSchedulerParam: {
          startingFeeBps: p.feeBps,
          endingFeeBps: p.feeBps,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: 0,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: 1,
      migrationFeeOption: 1,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 100,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: 1,
    initialMarketCap: p.initialMarketCap,
    migrationMarketCap: p.migrationMarketCap,
    liquidityWeights: preset.weights,
  });
}
export const client = new sdk.DynamicBondingCurveClient(
  new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed",
  ),
  "confirmed",
);
export const units = (n, d = 9) =>
  new BN(BigInt(Math.round(n * 10 ** d)).toString());
const num = (v, d = 0) => Number(v.toString()) / 10 ** d;
const price = (q) => (Number(q.toString()) / 2 ** 64) ** 2 * 0.001;
export function normalized(c) {
  return {
    ...c,
    migrationSqrtPrice: sdk.getMigrationThresholdPrice(
      c.migrationQuoteThreshold,
      c.sqrtStartPrice,
      c.curve,
    ),
    poolFees: {
      ...c.poolFees,
      dynamicFee: { initialized: 0, binStep: 0, variableFeeControl: 0 },
    },
  };
}
export function poolAt(c) {
  return {
    poolState: {
      sqrtPrice: c.sqrtStartPrice,
      baseReserve: new BN(0),
      quoteReserve: new BN(0),
      activationPoint: new BN(0),
      volatilityTracker: {
        lastUpdateTimestamp: new BN(0),
        sqrtPriceReference: new BN(0),
        volatilityAccumulator: new BN(0),
        volatilityReference: new BN(0),
        padding: [],
      },
    },
  };
}
export function analyze(input) {
  const p = validate(input);
  return presets.map((preset) => {
    const config = build(p, preset.id),
      threshold = num(config.migrationQuoteThreshold, 9),
      points = [{ reserve: 0, price: price(config.sqrtStartPrice), tokens: 0 }];
    for (let i = 1; i <= 60; i++) {
      const reserve = ((threshold * i) / 60) * 0.999;
      const q = client.pool.getQuoteFromInputAmount({
        config,
        swapBaseForQuote: false,
        amountIn: units(reserve / (1 - p.feeBps / 10000)),
        slippageBps: p.slippageBps,
      });
      points.push({
        reserve,
        price: price(q.nextSqrtPrice),
        tokens: num(q.outputAmount, 6),
      });
    }
    return {
      ...preset,
      threshold,
      startPrice: price(config.sqrtStartPrice),
      endPrice: price(normalized(config).migrationSqrtPrice),
      points,
      config,
    };
  });
}
export function simulate(input, id, trades) {
  const p = validate(input),
    c = normalized(build(p, id)),
    pool = poolAt(c);
  if (!Array.isArray(trades) || trades.length > 100)
    throw Error("Use at most 100 trades");
  let held = new BN(0),
    fees = 0;
  const rows = [];
  for (const [i, t] of trades.entries()) {
    if (
      !["buy", "sell"].includes(t.side) ||
      !Number.isFinite(t.amount) ||
      t.amount <= 0 ||
      t.amount > 1e12
    )
      throw Error(`Invalid trade ${i + 1}`);
    const sell = t.side === "sell",
      amount = units(t.amount, sell ? 6 : 9);
    if (sell && amount.gt(held))
      throw Error(`Trade ${i + 1}: insufficient simulated token balance`);
    if (pool.poolState.quoteReserve.gte(c.migrationQuoteThreshold))
      throw Error(`Trade ${i + 1}: curve graduated; DBC trading stops`);
    const q = client.pool.swapQuote({
      virtualPool: pool,
      config: c,
      swapBaseForQuote: sell,
      amountIn: amount,
      slippageBps: p.slippageBps,
      hasReferral: false,
      eligibleForFirstSwapWithMinFee: false,
      currentPoint: new BN(0),
    });
    if (q.amountLeft && !q.amountLeft.isZero())
      throw Error(`Trade ${i + 1} exceeds curve capacity`);
    const fee = q.tradingFee.add(q.protocolFee);
    if (sell) {
      held = held.sub(amount);
      pool.poolState.quoteReserve = pool.poolState.quoteReserve.sub(
        q.outputAmount.add(fee),
      );
    } else {
      held = held.add(q.outputAmount);
      pool.poolState.quoteReserve = pool.poolState.quoteReserve.add(
        amount.sub(fee),
      );
    }
    pool.poolState.sqrtPrice = q.nextSqrtPrice;
    fees += num(fee, 9);
    rows.push({
      index: i + 1,
      side: t.side,
      input: t.amount,
      output: num(q.outputAmount, sell ? 9 : 6),
      minimum: num(q.minimumAmountOut, sell ? 9 : 6),
      fee: num(fee, 9),
      price: price(q.nextSqrtPrice),
      reserve: num(pool.poolState.quoteReserve, 9),
      held: num(held, 6),
    });
  }
  return {
    rows,
    fees,
    held: num(held, 6),
    reserve: num(pool.poolState.quoteReserve, 9),
    threshold: num(c.migrationQuoteThreshold, 9),
  };
}
export function serialize(value) {
  if (BN.isBN(value)) return value.toString();
  if (value && typeof value.toBase58 === "function") return value.toBase58();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serialize(v)]),
    );
  return value;
}
