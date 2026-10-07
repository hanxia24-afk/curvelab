# CurveLab demo script

## Product pitch

CurveLab helps launchpad builders understand and verify their token distribution before launch. Three apparently similar market-cap targets can result in very different token allocations and graduation capital requirements. CurveLab uses Meteora's real SDK to expose those differences and turn a selected design into a wallet-signed Devnet transaction.

## 90-second product walkthrough

1. Start on 曲线设计. Show 1 billion supply, initial market cap 30 SOL, graduation target 300 SOL and 1% fixed fee.
2. Compare Balanced / Patient launch / Momentum. Point out the SDK-generated graduation reserves: approximately 71.355 / 51.535 / 95.822 SOL. These are reserves, not guaranteed funding or dollar valuations.
3. Click 进入交易实验 and 运行三套曲线. The same four trades produce different holdings and graduation progress. Show the SDK minimum-received column and sell-side quote fee.
4. Export the experiment and configuration for reproducible review.
5. Open Devnet 发行. Explain the selected fee and LP allocation, preflight and wallet signature. If no funded Phantom wallet is available, explicitly describe this screen as an implemented but not end-to-end verified integration.

## Honest submission status

Working local product and SDK math are verified. A live mainnet launch, users, volume and confirmed DBC→DAMM v2 migration have not been achieved. Do not substitute simulation screenshots for chain evidence or invent traction. The README records the current Devnet faucet blocker and dependency audit.

## Follow-up before competition submission

Obtain a funded Devnet test wallet, verify creation plus real buys and DAMM v2 migration, publish accessible token metadata, host the product/API with appropriate request controls, record a demo video, and obtain feedback from real launchpad builders. Check the independent Meteora sidetrack submission deadline and required fields. Submission has not been performed by this project.
