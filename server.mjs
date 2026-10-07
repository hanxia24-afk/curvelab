import http from "node:http";
import { createServer as createViteServer } from "vite";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  analyze,
  build,
  simulate,
  serialize,
  client,
  validate,
} from "./engine.mjs";
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});
const pending = new Map();
const connection = client.state.getProgram().provider.connection;
async function requireDevnet() {
  if (
    (await connection.getGenesisHash()) !==
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  )
    throw Error("RPC is not Solana Devnet; transaction blocked");
}
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/api/")) return vite.middlewares(req, res);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!["localhost:5173", "127.0.0.1:5173"].includes(req.headers.host))
      throw Error("Untrusted host");
    const origin = req.headers.origin;
    if (
      origin &&
      !["http://localhost:5173", "http://127.0.0.1:5173"].includes(origin)
    )
      throw Error("Untrusted origin");
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 65536) throw Error("Request too large");
    }
    const data = body ? JSON.parse(body) : {};
    let result;
    if (req.url === "/api/analyze") result = analyze(data);
    else if (req.url === "/api/simulate")
      result = simulate(data.params, data.preset, data.trades);
    else if (req.url === "/api/prepare") {
      await requireDevnet();
      validate(data.params);
      const payer = new PublicKey(data.wallet);
      if (
        typeof data.name !== "string" ||
        data.name.length < 1 ||
        data.name.length > 32 ||
        !/^\w{1,10}$/.test(data.symbol)
      )
        throw Error(
          "Name must be 1–32 characters; symbol 1–10 letters/numbers",
        );
      if (data.uri && !/^https:\/\//.test(data.uri))
        throw Error("Metadata URI must use HTTPS");
      if ((data.uri || "").length > 200) throw Error("Metadata URI too long");
      const config = Keypair.generate(),
        mint = Keypair.generate();
      const tx = await client.partner.createConfigAndPool({
        config: config.publicKey,
        feeClaimer: payer,
        leftoverReceiver: payer,
        payer,
        quoteMint: new PublicKey("So11111111111111111111111111111111111111112"),
        ...build(data.params, data.preset),
        preCreatePoolParam: {
          name: data.name,
          symbol: data.symbol,
          uri: data.uri || "",
          poolCreator: payer,
          baseMint: mint.publicKey,
        },
      });
      const latest = await client.state
        .getProgram()
        .provider.connection.getLatestBlockhash("confirmed");
      tx.feePayer = payer;
      tx.recentBlockhash = latest.blockhash;
      tx.partialSign(config, mint);
      const simulation = await client.state
        .getProgram()
        .provider.connection.simulateTransaction(tx);
      if (simulation.value.err)
        throw Error(
          `Devnet preflight failed: ${JSON.stringify(simulation.value.err)}. Check wallet funding. ${simulation.value.logs?.slice(-3).join(" ") || ""}`,
        );
      const id = crypto.randomUUID();
      pending.set(id, {
        ...latest,
        mint: mint.publicKey.toBase58(),
        message: tx.serializeMessage().toString("base64"),
        created: Date.now(),
      });
      for (const [key, v] of pending)
        if (Date.now() - v.created > 300000) pending.delete(key);
      result = {
        id,
        transaction: tx
          .serialize({ requireAllSignatures: false })
          .toString("base64"),
        mint: mint.publicKey.toBase58(),
        config: config.publicKey.toBase58(),
        network: "devnet",
      };
    } else if (req.url === "/api/submit") {
      await requireDevnet();
      const info = pending.get(data.id);
      if (!info || Date.now() - info.created > 120000)
        throw Error("Transaction expired; prepare again");
      const signed = Transaction.from(Buffer.from(data.transaction, "base64"));
      if (signed.serializeMessage().toString("base64") !== info.message)
        throw Error("Signed transaction differs from prepared configuration");
      const signature = await client.state
        .getProgram()
        .provider.connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
        });
      pending.delete(data.id);
      const confirmation = await client.state
        .getProgram()
        .provider.connection.confirmTransaction(
          {
            signature,
            blockhash: info.blockhash,
            lastValidBlockHeight: info.lastValidBlockHeight,
          },
          "confirmed",
        );
      if (confirmation.value.err)
        throw Error(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
        );
      result = { signature, mint: info.mint };
    } else if (req.url === "/api/pool") {
      await requireDevnet();
      const pool = await client.state.getPoolByBaseMint(
        new PublicKey(data.mint),
      );
      if (!pool) throw Error("No DBC pool found on devnet for this mint");
      const config = await client.state.getPoolConfig(
        pool.account.poolState.config,
      );
      result = {
        address: pool.publicKey.toBase58(),
        state: pool.account,
        config,
      };
    } else {
      res.statusCode = 404;
      throw Error("Unknown API");
    }
    res.end(JSON.stringify(serialize(result)));
  } catch (e) {
    res.statusCode = res.statusCode === 404 ? 404 : 400;
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(5173, "127.0.0.1", () =>
  console.log("CurveLab ready: http://localhost:5173"),
);
