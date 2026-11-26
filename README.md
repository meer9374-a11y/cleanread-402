# CleanRead-402

Universal x402, A2A & Remote MCP Clean Web Reader for AI Agents ($0.05 USDC, Zero API Keys): Converts any URL into token-compressed, LLM-ready Markdown and structured links for Claude, Cursor, LangChain, ElizaOS, and Coinbase AgentKit.

[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](LICENSE)
[![Network: Base Mainnet](https://img.shields.io/badge/Base%20L2-USDC%20x402-0052ff.svg)](https://cleanread-402.vercel.app/.well-known/x402.json)
[![MCP: 2024-11-05](https://img.shields.io/badge/Remote%20MCP-2024--11--05-38bdf8.svg)](https://cleanread-402.vercel.app/mcp)
[![A2A: Agent Card](https://img.shields.io/badge/Google%20A2A-Agent%20Card-a855f7.svg)](https://cleanread-402.vercel.app/.well-known/agent.json)

---

## Why CleanRead-402?

AI agents waste 70–95% of their context window parsing bloated raw HTML (`<script>`, `<style>`, trackers, navbars, cookie banners) or hit monthly SaaS paywalls and API key sign-ups.

**CleanRead-402** is a stateless, zero-dependency Node.js ES Module micro-node deployed on Vercel Edge/Serverless with **direct on-chain Base L2 USDC settlement (`x402`)**:

- **$0.05 USDC Per Call (`50000` base units) — Zero API Keys, Zero Subscriptions:** Pay per request on Base Mainnet (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) to `0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7` and pass `X-Payment-Tx: <0x_tx_hash>`.
- **Stateless Base RPC Verification:** Verifies `status === "0x1"`, USDC `Transfer` log amount `>= 50000`, and block timestamp within `600` seconds directly against `https://mainnet.base.org` (fallback `https://base.llamarpc.com`).
- **Free Schema & Preview Mode (`?demo=true`):** Returns the first `600` characters of clean Markdown + full token-compression telemetry (`originalBytes`, `compressedBytes`, `estimatedTokensSaved`), edge-cached for 60s so agents and MCP registries can test at zero cost.
- **Triple-Protocol Interoperability:** Native **Remote MCP (`2024-11-05`)**, **Google A2A (`/.well-known/agent.json` + `/a2a`)**, and **x402 REST (`/api/v1/extract`)**.

---

## 4-Line Remote MCP Setup (Claude Desktop / Cursor / Windsurf)

Add to `claude_desktop_config.json` or `.cursor/mcp.json` (see [`examples/claude_mcp_config.json`](examples/claude_mcp_config.json)):

```json
{
  "mcpServers": {
    "cleanread-402": { "url": "https://cleanread-402.vercel.app/mcp" }
  }
}
```

### Exposed MCP Tools
1. **`extract_clean_markdown`** — Converts any `http://` or `https://` URL into clean, token-compressed Markdown (`{ title, url, cleanMarkdown, originalBytes, compressedBytes, estimatedTokensSaved, links }`). Supports `demo: true` (free) or `payment_tx: "0x..."` ($0.05 USDC).
2. **`batch_extract_links`** — Extracts deduplicated, absolute structured links (`[{ text, url }]`) and byte/token compression stats across up to 3 URLs in parallel.

---

## REST & x402 Micro-API Usage

### 1. Free Demo Preview (`HTTP 200`, Edge-Cached 60s)
```bash
curl "https://cleanread-402.vercel.app/api/v1/extract?url=https://modelcontextprotocol.io/introduction&demo=true"
```

### 2. Unpaid Request -> Standard `HTTP 402 Payment Required` Invoice
```bash
curl -i "https://cleanread-402.vercel.app/api/v1/extract?url=https://modelcontextprotocol.io/introduction"
```
Returns standard x402 JSON:
```json
{
  "x402Version": 1,
  "payTo": "0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7",
  "network": "base",
  "chainId": 8453,
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "maxAmountRequired": "50000",
  "priceUsdc": "0.05",
  "paymentHeader": "X-Payment-Tx"
}
```

### 3. Paid Full Extraction (`X-Payment-Tx`)
```bash
curl "https://cleanread-402.vercel.app/api/v1/extract?url=https://modelcontextprotocol.io/introduction" \
  -H "X-Payment-Tx: 0xYOUR_BASE_MAINNET_USDC_TX_HASH"
```

---

## Agent SDK Examples

- **Claude / Cursor MCP:** [`examples/claude_mcp_config.json`](examples/claude_mcp_config.json)
- **Coinbase AgentKit (TypeScript):** [`examples/coinbase_agentkit_reader.ts`](examples/coinbase_agentkit_reader.ts)
- **LangChain / Python Agents:** [`examples/langchain_reader.py`](examples/langchain_reader.py)

---

## 6-Layer AI Discovery Surface (`Access-Control-Allow-Origin: *`)

| Layer | Endpoint | Purpose |
| :--- | :--- | :--- |
| **x402 Manifest** | [`/.well-known/x402.json`](https://cleanread-402.vercel.app/.well-known/x402.json) | x402 Bazaar & Coinbase AgentKit discovery |
| **MCP Manifest** | [`/.well-known/mcp.json`](https://cleanread-402.vercel.app/.well-known/mcp.json) | Remote MCP `2024-11-05` streamable-http manifest |
| **A2A Agent Card** | [`/.well-known/agent.json`](https://cleanread-402.vercel.app/.well-known/agent.json) | Google A2A skills (`url-to-markdown`, `web-reader`) |
| **LLMs Index** | [`/llms.txt`](https://cleanread-402.vercel.app/llms.txt) | Markdown index for LLM crawlers & RAG |
| **OpenAPI 3.1** | [`/openapi.json`](https://cleanread-402.vercel.app/openapi.json) | OpenAPI 3.1 spec with `x-payment-required: true` |
| **Crawler Policy** | [`/robots.txt`](https://cleanread-402.vercel.app/robots.txt) | Welcomes `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended` |

---

## Self-Verification Suite

```bash
node test_x402.mjs https://cleanread-402.vercel.app
```

---

## License

MIT License — see [LICENSE](LICENSE). Maintained by [`@meer9374-a11y`](https://github.com/meer9374-a11y).
