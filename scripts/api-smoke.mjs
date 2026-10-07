import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { defaults } from "../engine.mjs";
const evidence = [];
async function post(path, data, headers = {}) {
  const response = await fetch(`http://127.0.0.1:5173/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
const curves = await post("analyze", defaults);
assert.equal(curves.status, 200);
assert.equal(curves.body.length, 3);
evidence.push({ check: "SDK analysis endpoint", status: "passed" });
const scenario = await post("simulate", {
  params: defaults,
  preset: "balanced",
  trades: [
    { side: "buy", amount: 1 },
    { side: "sell", amount: 1000 },
  ],
});
assert.equal(scenario.status, 200);
assert.equal(scenario.body.rows.length, 2);
evidence.push({ check: "Sequential scenario endpoint", status: "passed" });
const invalid = await post("analyze", { ...defaults, migrationMarketCap: 1 });
assert.equal(invalid.status, 400);
evidence.push({ check: "Invalid configuration returns 400", status: "passed" });
const untrusted = await post("analyze", defaults, {
  Origin: "https://untrusted.example",
});
assert.equal(untrusted.status, 400);
assert.equal(untrusted.body.error, "Untrusted origin");
evidence.push({ check: "Untrusted origin is rejected", status: "passed" });
const unknown = await post("unknown", {});
assert.equal(unknown.status, 404);
evidence.push({ check: "Unknown API returns 404", status: "passed" });
await writeFile("api-evidence.json", JSON.stringify(evidence, null, 2));
console.log("5 API checks passed");
