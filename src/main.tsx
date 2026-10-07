import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import { Transaction } from "@solana/web3.js";
import "./style.css";
type Params = {
  supply: number;
  initialMarketCap: number;
  migrationMarketCap: number;
  feeBps: number;
  slippageBps: number;
};
type Curve = {
  id: string;
  name: string;
  description: string;
  color: string;
  threshold: number;
  startPrice: number;
  endPrice: number;
  points: { reserve: number; price: number; tokens: number }[];
  config: unknown;
};
type Trade = { side: "buy" | "sell"; amount: number };
type Row = {
  index: number;
  side: string;
  input: number;
  output: number;
  minimum: number;
  fee: number;
  price: number;
  reserve: number;
  held: number;
};
type Result = {
  rows: Row[];
  fees: number;
  held: number;
  reserve: number;
  threshold: number;
};
type Wallet = {
  publicKey: { toBase58(): string };
  connect(): Promise<void>;
  signTransaction(t: Transaction): Promise<Transaction>;
};
declare global {
  interface Window {
    solana?: Wallet;
    phantom?: { solana?: Wallet };
  }
}
const initial: Params = {
  supply: 1e9,
  initialMarketCap: 30,
  migrationMarketCap: 300,
  feeBps: 100,
  slippageBps: 100,
};
const format = (n: number, d = 3) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";
const api = async (path: string, data: unknown) => {
  const response = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Request failed");
  return result;
};
const download = (name: string, value: unknown) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};
function Chart({ curves, selected }: { curves: Curve[]; selected: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 790,
    h = 280,
    left = 68,
    right = 24,
    top = 28,
    bottom = 42;
  const maxX = Math.max(...curves.map((c) => c.threshold), 1),
    maxY = Math.max(...curves.map((c) => c.endPrice), 1e-9);
  const x = (n: number) => left + (n / maxX) * (w - left - right),
    y = (n: number) => h - bottom - (n / maxY) * (h - top - bottom);
  return (
    <div className="chart">
      <svg
        role="img"
        aria-label="三套 DBC 曲线：横轴累计净 SOL 储备，纵轴代币 SOL 价格"
        viewBox={`0 0 ${w} ${h}`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(
            Math.max(
              0,
              Math.min(
                maxX,
                ((((e.clientX - rect.left) / rect.width) * w - left) /
                  (w - left - right)) *
                  maxX,
              ),
            ),
          );
        }}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={w - right}
              y1={y((maxY * i) / 4)}
              y2={y((maxY * i) / 4)}
              className="gridline"
            />
            <text
              x={left - 10}
              y={y((maxY * i) / 4) + 4}
              textAnchor="end"
              className="axis"
            >
              {((maxY * i) / 4).toExponential(1)}
            </text>
            <text
              x={x((maxX * i) / 4)}
              y={h - 15}
              textAnchor="middle"
              className="axis"
            >
              {format((maxX * i) / 4, 1)}
            </text>
          </g>
        ))}
        {curves.map((c) => (
          <g key={c.id}>
            <path
              d={c.points
                .map((p, i) => `${i ? "L" : "M"} ${x(p.reserve)} ${y(p.price)}`)
                .join(" ")}
              stroke={c.color}
              fill="none"
              strokeWidth={selected === c.id ? 3 : 1.8}
              opacity={selected === c.id ? 1 : 0.55}
            />
            <circle
              cx={x(c.threshold * 0.999)}
              cy={y(c.points.at(-1)!.price)}
              r={selected === c.id ? 5 : 3}
              fill={c.color}
            />
          </g>
        ))}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={top}
            y2={h - bottom}
            stroke="#70796d"
            strokeDasharray="4 4"
          />
        )}
        <text x={left} y={14} className="axis">
          TOKEN PRICE · SOL
        </text>
        <text x={w - right} y={h - 1} className="axis" textAnchor="end">
          NET QUOTE RESERVE · SOL
        </text>
      </svg>
      {hover !== null && (
        <div className="chart-tooltip">
          储备 {format(hover)} SOL{" "}
          {curves
            .filter((c) => hover <= c.threshold)
            .map((c) => {
              const p = c.points.reduce((a, b) =>
                Math.abs(b.reserve - hover) < Math.abs(a.reserve - hover)
                  ? b
                  : a,
              );
              return (
                <span key={c.id} style={{ color: c.color }}>
                  {c.name}: {p.price.toExponential(3)}
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}
function App() {
  const [params, setParams] = useState<Params>(() => {
    try {
      return {
        ...initial,
        ...JSON.parse(localStorage.getItem("curvelab.params") || "{}"),
      };
    } catch {
      return initial;
    }
  });
  const [curves, setCurves] = useState<Curve[]>([]),
    [selected, setSelected] = useState("balanced"),
    [tab, setTab] = useState("design"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [trades, setTrades] = useState<Trade[]>([
      { side: "buy", amount: 1 },
      { side: "buy", amount: 2 },
      { side: "sell", amount: 1000000 },
      { side: "buy", amount: 5 },
    ]),
    [results, setResults] = useState<Record<string, Result>>({}),
    [busy, setBusy] = useState(false),
    [wallet, setWallet] = useState(""),
    [name, setName] = useState("CurveLab Demo"),
    [symbol, setSymbol] = useState("CLAB"),
    [uri, setUri] = useState(""),
    [prepared, setPrepared] = useState<any>(null),
    [receipt, setReceipt] = useState<any>(null),
    [mint, setMint] = useState(""),
    [pool, setPool] = useState<any>(null),
    [status, setStatus] = useState("");
  const requestId = useRef(0);
  const curve = curves.find((c) => c.id === selected);
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setPrepared(null);
    setResults({});
    const timer = setTimeout(
      () =>
        api("analyze", params)
          .then((data) => {
            if (id === requestId.current) {
              setCurves(data);
              setError("");
              localStorage.setItem("curvelab.params", JSON.stringify(params));
            }
          })
          .catch((e) => {
            if (id === requestId.current) {
              setError(e.message);
              setCurves([]);
            }
          })
          .finally(() => {
            if (id === requestId.current) setLoading(false);
          }),
      250,
    );
    return () => clearTimeout(timer);
  }, [params]);
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const connect = () =>
    work(async () => {
      const provider = window.phantom?.solana || window.solana;
      if (!provider)
        throw Error("请在浏览器安装 Phantom 钱包，切换到 Devnet 后重试");
      await provider.connect();
      setWallet(provider.publicKey.toBase58());
      setPrepared(null);
    });
  const simulate = () =>
    work(async () => {
      const list = await Promise.all(
        curves.map(
          async (c) =>
            [
              c.id,
              await api("simulate", { params, preset: c.id, trades }),
            ] as const,
        ),
      );
      setResults(Object.fromEntries(list));
      setStatus("三套配置已使用相同交易序列完成 SDK 报价。");
    });
  const prepare = () =>
    work(async () => {
      setPrepared(null);
      setReceipt(null);
      setStatus("正在读取 Devnet 并执行链上预检…");
      const tx = await api("prepare", {
        params,
        preset: selected,
        wallet,
        name,
        symbol,
        uri,
      });
      setPrepared(tx);
      setStatus("预检通过。请核对配置，再通过钱包签名发送。");
    });
  const submit = () =>
    work(async () => {
      const provider = window.phantom?.solana || window.solana;
      if (!provider || provider.publicKey.toBase58() !== wallet)
        throw Error("钱包已改变，请重新连接和预检");
      const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
      const signed = await provider.signTransaction(tx);
      setStatus("正在等待 Devnet 确认…");
      const result = await api("submit", {
        id: prepared.id,
        transaction: Buffer.from(signed.serialize()).toString("base64"),
      });
      setReceipt(result);
      setMint(result.mint);
      setPrepared(null);
      setStatus("Devnet 发行交易已确认。");
    });
  return (
    <div className="app">
      <aside className="sidebar">
        <a href="#" className="brand">
          <span className="brand-mark">◒</span> CurveLab
          <span className="beta">LAB / 01</span>
        </a>
        <div className="nav-label">LAUNCH WORKSPACE</div>
        <nav>
          {[
            ["design", "01", "曲线设计"],
            ["simulate", "02", "交易实验"],
            ["launch", "03", "Devnet 发行"],
          ].map(([id, n, label]) => (
            <button
              key={id}
              disabled={busy}
              onClick={() => {
                setTab(id);
                setStatus("");
              }}
              className={tab === id ? "active" : ""}
            >
              <span>{n}</span>
              {label}
              <b>↗</b>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="mini-orbit">◎</div>
          <p>
            Better launches
            <br />
            start with better curves.
          </p>
          <small>POWERED BY METEORA DBC</small>
          <a
            href="https://docs.meteora.ag/developer-guides/dbc"
            target="_blank"
            rel="noreferrer"
          >
            开发文档 ↗
          </a>
        </div>
        <div className="sidebar-bottom">
          <span className="dot" /> LOCAL WORKSPACE <span>v0.1</span>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            WORKSPACE <span>/</span>{" "}
            {tab === "design"
              ? "CURVE DESIGN"
              : tab === "simulate"
                ? "TRADE SIMULATION"
                : "DEVNET LAUNCH"}
          </div>
          <button className="wallet" onClick={connect} disabled={busy}>
            <span className="dot" />
            {wallet
              ? wallet.slice(0, 4) + "…" + wallet.slice(-4)
              : "连接钱包"}{" "}
            <span>↗</span>
          </button>
        </header>
        <section className="heading">
          <div>
            <div className="eyebrow">DESIGN. SIMULATE. LAUNCH.</div>
            <h1>
              {tab === "design" ? (
                <>
                  Every launch
                  <br />
                  has a <em>shape.</em>
                </>
              ) : tab === "simulate" ? (
                <>
                  Test the market.
                  <br />
                  <em>Before the launch.</em>
                </>
              ) : (
                <>
                  From hypothesis
                  <br />
                  to <em>onchain.</em>
                </>
              )}
            </h1>
            <p>
              {tab === "design"
                ? "在发行之前，理解你的曲线。对比三种流动性分布，用真实 SDK 数学验证每一个选择。"
                : tab === "simulate"
                  ? "让相同的买卖序列走过不同曲线，看清代币分配、交易费用与毕业进度。"
                  : "将选定的配置部署到 Solana Devnet，观察资产从 DBC 走向 DAMM v2。"}
            </p>
          </div>
          <div className="heading-stamp">
            <span>METEORA</span>
            <strong>
              DBC →<br />
              DAMM v2
            </strong>
            <small>OFFICIAL SDK MATH</small>
          </div>
        </section>
        {error && (
          <div role="alert" className="message error">
            {error}
          </div>
        )}
        {status && (
          <div role="status" className="message">
            {status}
          </div>
        )}
        {tab === "design" && (
          <>
            <div className="design-grid">
              <section className="panel configuration">
                <div className="panel-heading">
                  <h2>发行参数</h2>
                  <span>01 / CONFIGURE</span>
                </div>
                <div className="quote-label">
                  <span className="sol-icon">≋</span>
                  <div>
                    SOL<small>固定报价资产 · 9 decimals</small>
                  </div>
                  <span className="tag">DEVNET</span>
                </div>
                {(
                  [
                    ["supply", "代币总供应量", "TOKEN · 6 decimals"],
                    ["initialMarketCap", "初始市值", "SOL"],
                    ["migrationMarketCap", "毕业目标市值", "SOL"],
                    ["feeBps", "固定交易费", "BPS · 100 = 1%"],
                    ["slippageBps", "报价滑点容忍度", "BPS"],
                  ] as const
                ).map(([key, label, unit]) => (
                  <label className="field" key={key}>
                    <span>
                      {label}
                      <small>{unit}</small>
                    </span>
                    <input
                      disabled={busy}
                      aria-label={label}
                      type="number"
                      min={key === "slippageBps" ? 0 : 1}
                      value={params[key]}
                      onChange={(e) =>
                        setParams({ ...params, [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                <button
                  className="text-button"
                  onClick={() => setParams(initial)}
                >
                  ↺ 恢复默认参数
                </button>
              </section>
              <section className="panel visual">
                <div className="panel-heading">
                  <h2>价格发现曲线</h2>
                  <span className="live-indicator">
                    {loading ? "COMPUTING…" : "SDK QUOTE MATH"}
                  </span>
                </div>
                <Chart curves={curves} selected={selected} />
                <div className="chart-legend">
                  {curves.map((c) => (
                    <button onClick={() => setSelected(c.id)} key={c.id}>
                      <i style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))}
                  <span>● 曲线毕业端点</span>
                </div>
                <div className="chart-footnote">
                  横轴为扣费后池子净储备，纵轴为 SOL /
                  TOKEN。报价采用固定费用，不包含网络费。
                </div>
              </section>
            </div>
            <div className="section-label">
              <h2>选择你的发行节奏</h2>
              <span>THREE DISTRIBUTIONS. SAME MARKET CAP TARGETS.</span>
            </div>
            <div className="preset-grid">
              {curves.map((c, i) => (
                <button
                  key={c.id}
                  className={`preset ${selected === c.id ? "selected" : ""}`}
                  style={{ "--accent": c.color } as React.CSSProperties}
                  onClick={() => {
                    setSelected(c.id);
                    setPrepared(null);
                  }}
                >
                  <div className="preset-top">
                    <span>
                      0{i + 1} / {c.name.toUpperCase()}
                    </span>
                    <span>{selected === c.id ? "●" : "○"}</span>
                  </div>
                  <h3>{["均衡发现", "耐心发行", "后程蓄力"][i]}</h3>
                  <p>
                    {
                      [
                        "价格区间均匀分配流动性，作为比较基线。",
                        "早期价格区间流动性更厚，降低初期价格移动。",
                        "后期价格区间流动性更厚，改变发行节奏。",
                      ][i]
                    }
                  </p>
                  <div className="preset-stat">
                    <small>SDK 计算毕业门槛</small>
                    <strong>
                      {format(c.threshold)} <span>SOL</span>
                    </strong>
                  </div>
                </button>
              ))}
            </div>
            <div className="action-bar">
              <p>
                <span className="dot" /> 配置由官方 SDK 生成 · 16 段流动性 ·
                固定费用
              </p>
              <button
                className="secondary"
                disabled={!curve || loading}
                onClick={() =>
                  download("curvelab-config.json", {
                    version: 1,
                    network: "devnet",
                    quote: "SOL",
                    params,
                    preset: selected,
                    config: curve?.config,
                    integerEncoding: "BN fields are decimal strings",
                    leftoverPercent: 1,
                  })
                }
              >
                导出配置 ↓
              </button>
              <button
                className="primary"
                disabled={!curve || loading}
                onClick={() => setTab("simulate")}
              >
                进入交易实验 ↗
              </button>
            </div>
          </>
        )}
        {tab === "simulate" && (
          <>
            <div className="simulation-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>交易序列</h2>
                  <span>SHARED SCENARIO</span>
                </div>
                <p className="muted">
                  买入以 SOL 计量；卖出以 TOKEN
                  计量。所有操作使用同一个模拟账户。
                </p>
                {trades.map((t, i) => (
                  <div className="trade-input" key={i}>
                    <span className="trade-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <select
                      disabled={busy}
                      aria-label={`交易 ${i + 1} 方向`}
                      value={t.side}
                      onChange={(e) => {
                        setTrades(
                          trades.map((x, j) =>
                            i === j
                              ? { ...x, side: e.target.value as Trade["side"] }
                              : x,
                          ),
                        );
                        setResults({});
                      }}
                    >
                      <option value="buy">买入 SOL</option>
                      <option value="sell">卖出 TOKEN</option>
                    </select>
                    <input
                      disabled={busy}
                      aria-label={`交易 ${i + 1} 数量`}
                      type="number"
                      min="0.000001"
                      value={t.amount}
                      onChange={(e) => {
                        setTrades(
                          trades.map((x, j) =>
                            i === j
                              ? { ...x, amount: Number(e.target.value) }
                              : x,
                          ),
                        );
                        setResults({});
                      }}
                    />
                    <button
                      aria-label={`删除交易 ${i + 1}`}
                      className="remove"
                      onClick={() => {
                        setTrades(trades.filter((_, j) => j !== i));
                        setResults({});
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={trades.length >= 100}
                    onClick={() => {
                      setTrades([...trades, { side: "buy", amount: 1 }]);
                      setResults({});
                    }}
                  >
                    ＋ 添加交易
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy || loading || !curves.length || !trades.length
                    }
                    onClick={simulate}
                  >
                    {busy ? "计算中…" : "运行三套曲线 ↗"}
                  </button>
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>实验说明</h2>
                  <span>MODEL BOUNDARIES</span>
                </div>
                <h3 className="callout">
                  真实报价数学。
                  <br />
                  明确的模拟边界。
                </h3>
                <p className="muted">
                  连续交易通过 SDK swapQuote
                  计算并更新模拟价格、净储备和持仓。无动态费、无外部交易、无
                  MEV、无网络费。滑点字段提供最低接收数量，并不预测成交失败概率。
                </p>
                <p className="muted">
                  达到毕业边界后 DBC 模拟停止，不将后续交易假装成 DAMM v2
                  交易。毕业池费用为 0.3%，100% 创建者 LP 永久锁定，1% leftover
                  归创建钱包。
                </p>
                <button
                  className="text-button"
                  onClick={() =>
                    download("curvelab-scenario.json", {
                      params,
                      trades,
                      results,
                    })
                  }
                >
                  导出实验结果 ↓
                </button>
              </section>
            </div>
            <div className="preset-grid">
              {curves.map((c) => (
                <button
                  className={`preset ${selected === c.id ? "selected" : ""}`}
                  style={{ "--accent": c.color } as React.CSSProperties}
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                >
                  <h3>{c.name}</h3>
                  <div className="preset-stat">
                    <small>模拟账户持仓</small>
                    <strong>
                      {results[c.id] ? format(results[c.id].held, 0) : "—"}{" "}
                      <span>TOKEN</span>
                    </strong>
                  </div>
                  <div className="progress">
                    <i
                      style={{
                        width: `${Math.min(100, ((results[c.id]?.reserve || 0) / c.threshold) * 100)}%`,
                      }}
                    />
                  </div>
                  <p>
                    毕业进度{" "}
                    {format(
                      ((results[c.id]?.reserve || 0) / c.threshold) * 100,
                      2,
                    )}
                    % · 费用 {format(results[c.id]?.fees || 0, 6)} SOL
                  </p>
                </button>
              ))}
            </div>
            <section className="panel table-panel">
              <div className="panel-heading">
                <h2>{curve?.name} / 交易明细</h2>
                <span>SDK SWAP QUOTES</span>
              </div>
              {results[selected] ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "步骤",
                          "方向",
                          "输入",
                          "输出",
                          "最低接收",
                          "费用 SOL",
                          "交易后价格 SOL",
                          "净储备 SOL",
                        ].map((x) => (
                          <th key={x}>{x}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results[selected].rows.map((r) => (
                        <tr key={r.index}>
                          <td>{r.index}</td>
                          <td className={r.side === "buy" ? "positive" : ""}>
                            {r.side === "buy" ? "BUY" : "SELL"}
                          </td>
                          <td>{format(r.input)}</td>
                          <td>{format(r.output, 6)}</td>
                          <td>{format(r.minimum, 6)}</td>
                          <td>{format(r.fee, 9)}</td>
                          <td>{r.price.toExponential(4)}</td>
                          <td>{format(r.reserve, 6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  ↗ 设置交易序列，运行实验后查看逐笔报价。
                </div>
              )}
            </section>
          </>
        )}
        {tab === "launch" && (
          <div className="simulation-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>发行到 Devnet</h2>
                <span>WALLET SIGNED</span>
              </div>
              <div className="network-note">
                仅连接 Solana Devnet · 需要钱包测试 SOL
              </div>
              <label className="field">
                <span>曲线预设</span>
                <select
                  disabled={busy}
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setPrepared(null);
                  }}
                >
                  {curves.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {[
                ["代币名称", name, setName],
                ["代币符号", symbol, setSymbol],
                ["Metadata URI（可选 HTTPS）", uri, setUri],
              ].map(([label, value, setter]) => (
                <label className="field" key={label as string}>
                  <span>{label as string}</span>
                  <input
                    disabled={busy}
                    value={value as string}
                    onChange={(e) => {
                      (setter as (s: string) => void)(e.target.value);
                      setPrepared(null);
                    }}
                  />
                </label>
              ))}
              <p className="muted">
                钱包提供签名，私钥留在钱包中。请将钱包切换到 Devnet。空 URI
                适合流程测试，正式演示应提供可访问的代币元数据。
              </p>
              <button
                className="primary wide"
                disabled={busy || loading || !curve}
                onClick={wallet ? prepare : connect}
              >
                {busy
                  ? "处理中…"
                  : wallet
                    ? "生成交易并执行预检 ↗"
                    : "连接 Phantom 钱包 ↗"}
              </button>
              {prepared && (
                <div className="prepared">
                  <p>预检通过 · 交易约两分钟内有效</p>
                  <small>Base mint</small>
                  <code>{prepared.mint}</code>
                  <button
                    className="primary wide"
                    disabled={busy}
                    onClick={submit}
                  >
                    钱包签名并发送到 Devnet ↗
                  </button>
                </div>
              )}
              {receipt && (
                <div className="message">
                  <strong>发行成功</strong>
                  <a
                    href={`https://explorer.solana.com/tx/${receipt.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看已确认交易 ↗
                  </a>
                </div>
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>配置与生命周期</h2>
                <span>DBC → DAMM v2</span>
              </div>
              <dl className="summary">
                <div>
                  <dt>已选预设</dt>
                  <dd>{curve?.name}</dd>
                </div>
                <div>
                  <dt>毕业门槛</dt>
                  <dd>{format(curve?.threshold || 0)} SOL</dd>
                </div>
                <div>
                  <dt>DBC 固定费</dt>
                  <dd>{params.feeBps / 100}%</dd>
                </div>
                <div>
                  <dt>DAMM v2 费率</dt>
                  <dd>0.3%</dd>
                </div>
                <div>
                  <dt>永久锁定 LP</dt>
                  <dd>100%</dd>
                </div>
                <div>
                  <dt>创建者交易费分成</dt>
                  <dd>50%（协议扣费后）</dd>
                </div>
                <div>
                  <dt>Leftover 配置</dt>
                  <dd>1% 供应量，归创建钱包</dd>
                </div>
              </dl>
              <label className="field">
                <span>Devnet 代币 Mint 地址</span>
                <input
                  disabled={busy}
                  value={mint}
                  onChange={(e) => setMint(e.target.value)}
                  placeholder="粘贴 base mint 查询真实池子"
                />
              </label>
              <button
                className="secondary wide"
                disabled={busy || !mint}
                onClick={() =>
                  work(async () => {
                    setPool(null);
                    setPool(await api("pool", { mint }));
                  })
                }
              >
                查询链上池子
              </button>
              {pool && (
                <>
                  <pre className="pool-data">
                    {JSON.stringify(pool, null, 2)}
                  </pre>
                  <button
                    className="text-button"
                    onClick={() => download("curvelab-devnet-pool.json", pool)}
                  >
                    导出链上状态 ↓
                  </button>
                </>
              )}
              <p className="muted">
                Devnet 毕业需要手动迁移。查询池子后，可用 Meteora
                官方迁移工具完成 DAMM v2 迁移；本 MVP 不自动执行迁移。
              </p>
              <a
                className="text-button"
                href="https://migrator.meteora.ag/"
                target="_blank"
                rel="noreferrer"
              >
                打开 Meteora Manual Migrator ↗
              </a>
            </section>
          </div>
        )}
        <footer>
          <span>CURVELAB / A LAUNCH DESIGN WORKSPACE</span>
          <span>
            Local simulation ≠ onchain execution{" "}
            <a
              href="https://github.com/MeteoraAg/dynamic-bonding-curve-sdk"
              target="_blank"
              rel="noreferrer"
            >
              SDK ↗
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
