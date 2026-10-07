import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { build, defaults, client, serialize } from "../engine.mjs";
const connection = client.state.getProgram().provider.connection;
await mkdir(".local", { recursive: true });
let payer;
try {
  if (
    (await connection.getGenesisHash()) !==
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  )
    throw Error("RPC is not Devnet; smoke test blocked");
  payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(await readFile(".local/devnet-test-wallet.json", "utf8")),
    ),
  );
} catch {
  payer = Keypair.generate();
  await writeFile(
    ".local/devnet-test-wallet.json",
    JSON.stringify(Array.from(payer.secretKey)),
  );
}
const evidence = {
  network: "devnet",
  wallet: payer.publicKey.toBase58(),
  startedAt: new Date().toISOString(),
  steps: [],
};
try {
  const version = await connection.getVersion();
  evidence.steps.push({ step: "rpc", status: "passed", version });
  console.log("Devnet RPC connected");
  let balance = await connection.getBalance(payer.publicKey);
  if (balance < 100000000) {
    console.log("Requesting test SOL from devnet faucet");
    const signature = await connection.requestAirdrop(
      payer.publicKey,
      2000000000,
    );
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ ...latest, signature }, "confirmed");
    balance = await connection.getBalance(payer.publicKey);
  }
  evidence.steps.push({ step: "funding", status: "passed", balance });
  const config = Keypair.generate(),
    mint = Keypair.generate(),
    params = { ...defaults, initialMarketCap: 0.03, migrationMarketCap: 0.3 };
  const tx = await client.partner.createConfigAndPool({
    config: config.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    payer: payer.publicKey,
    quoteMint: new PublicKey("So11111111111111111111111111111111111111112"),
    ...build(params, "balanced"),
    preCreatePoolParam: {
      name: "CurveLab Devnet Smoke",
      symbol: "CLTEST",
      uri: "",
      poolCreator: payer.publicKey,
      baseMint: mint.publicKey,
    },
  });
  const signature = await sendAndConfirmTransaction(connection, tx, [
    payer,
    config,
    mint,
  ]);
  evidence.steps.push({
    step: "create-config-and-pool",
    status: "passed",
    signature,
    mint: mint.publicKey.toBase58(),
  });
  const pool = await client.state.getPoolByBaseMint(mint.publicKey);
  if (!pool) throw Error("Created pool not found");
  evidence.steps.push({
    step: "read-pool",
    status: "passed",
    address: pool.publicKey.toBase58(),
    state: serialize(pool.account),
  });
  console.log("Pool creation confirmed:", signature);
} catch (error) {
  evidence.steps.push({
    step: "remaining-chain-validation",
    status: "blocked",
    reason: error.message,
  });
  console.log("Devnet smoke incomplete:", error.message);
  process.exitCode = 1;
} finally {
  await writeFile("devnet-evidence.json", JSON.stringify(evidence, null, 2));
}
