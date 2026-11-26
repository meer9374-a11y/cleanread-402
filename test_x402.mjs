#!/usr/bin/env node
/**
 * CleanRead-402 End-to-End Verification Suite (Zero Dependencies)
 * Verifies:
 *  1. GET /api/v1/health (Base Mainnet RPC connectivity & payTo config)
 *  2. GET /api/v1/extract?url=https://example.com -> HTTP 402 Payment Required (exact x402 contract)
 *  3. Invalid X-Payment-Tx rejection -> HTTP 402
 *  4. GET /api/v1/extract?url=https://example.com&demo=true -> HTTP 200 (<=600 chars + token savings + 60s edge cache)
 *  5. POST /mcp JSON-RPC 2.0 (initialize, notifications/initialized, tools/list, tools/call)
 *  6. All 6 Discovery Files (/.well-known/x402.json, /.well-known/mcp.json, /.well-known/agent.json, /llms.txt, /openapi.json, /robots.txt)
 */

const BASE_URL = (process.argv[2] || process.env.CLEANREAD_URL || 'https://cleanread-402.vercel.app').replace(/\/$/, '');
const EXPECTED_PAY_TO = '0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7';
const EXPECTED_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_AMOUNT = '50000';

let passed = 0;
let failed = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  console.log(`\n=== CleanRead-402 Production Verification Suite ===`);
  console.log(`Target Node: ${BASE_URL}\n`);

  // 1. Health check
  console.log('1. Checking /api/v1/health ...');
  const healthRes = await fetch(`${BASE_URL}/api/v1/health`);
  const health = await healthRes.json();
  assert(healthRes.status === 200, 'Health returns HTTP 200');
  assert(health.payTo === EXPECTED_PAY_TO, 'Health payTo matches Base wallet');
  assert(
    health.baseRpc?.status === 'healthy',
    'Base Mainnet RPC healthy',
    `${health.baseRpc?.latencyMs}ms @ block ${health.baseRpc?.latestBlock}`
  );

  // 2. Unpaid HTTP 402 check
  console.log('\n2. Checking unpaid /api/v1/extract -> HTTP 402 Payment Required ...');
  const unpaidRes = await fetch(`${BASE_URL}/api/v1/extract?url=https://example.com`);
  const unpaid = await unpaidRes.json();
  assert(unpaidRes.status === 402, 'Unpaid request returns HTTP 402');
  assert(
    unpaid.payTo === EXPECTED_PAY_TO &&
      unpaid.network === 'base' &&
      unpaid.asset === EXPECTED_USDC &&
      unpaid.maxAmountRequired === EXPECTED_AMOUNT,
    'x402 invoice matches exact wallet, Base USDC contract & 50000 base units ($0.05)'
  );

  // 3. Fake X-Payment-Tx rejection
  console.log('\n3. Checking stateless Base RPC X-Payment-Tx gate ...');
  const fakeTx = '0x' + '2'.repeat(64);
  const fakeRes = await fetch(`${BASE_URL}/api/v1/extract?url=https://example.com`, {
    headers: { 'X-Payment-Tx': fakeTx },
  });
  const fakeBody = await fakeRes.json();
  assert(fakeRes.status === 402, 'Fake/unconfirmed X-Payment-Tx rejected with HTTP 402', fakeBody.verificationError);

  // 4. Free ?demo=true preview check
  console.log('\n4. Checking free ?demo=true preview & edge cache ...');
  const demoRes = await fetch(`${BASE_URL}/api/v1/extract?url=https://example.com&demo=true`);
  const demo = await demoRes.json();
  assert(demoRes.status === 200, 'Demo preview returns HTTP 200');
  assert(
    typeof demo.title === 'string' &&
      typeof demo.url === 'string' &&
      typeof demo.cleanMarkdown === 'string' &&
      demo.cleanMarkdown.length > 0 &&
      demo.cleanMarkdown.length <= 600 &&
      typeof demo.originalBytes === 'number' &&
      typeof demo.compressedBytes === 'number' &&
      typeof demo.estimatedTokensSaved === 'number',
    'Demo schema valid (<=600 chars + token savings stats)',
    `orig=${demo.originalBytes}B, comp=${demo.compressedBytes}B, saved=${demo.estimatedTokensSaved} tokens`
  );
  assert(
    (demoRes.headers.get('cache-control') || '').includes('s-maxage=60') ||
      demoRes.headers.get('x-cache-policy') === 'cleanread-demo-edge-60s',
    'Demo enforces 60s edge caching (s-maxage=60)'
  );

  // 5. Remote MCP JSON-RPC 2.0
  console.log('\n5. Checking Remote MCP 2024-11-05 JSON-RPC 2.0 (/mcp) ...');
  const mcpInit = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  const mcpInitJson = await mcpInit.json();
  assert(mcpInitJson.result?.protocolVersion === '2024-11-05', 'MCP initialize protocolVersion === 2024-11-05');

  const mcpNotif = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert(mcpNotif.status === 202 || mcpNotif.status === 200, 'MCP notifications/initialized accepted');

  const mcpList = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const mcpListJson = await mcpList.json();
  const toolNames = (mcpListJson.result?.tools || []).map((t) => t.name);
  assert(
    toolNames.includes('extract_clean_markdown') && toolNames.includes('batch_extract_links'),
    'MCP tools/list exposes extract_clean_markdown & batch_extract_links',
    toolNames.join(', ')
  );

  const mcpCall = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'extract_clean_markdown', arguments: { url: 'https://example.com', demo: true } },
    }),
  });
  const mcpCallJson = await mcpCall.json();
  assert(Array.isArray(mcpCallJson.result?.content) && !mcpCallJson.result?.isError, 'MCP tools/call demo succeeds');

  // 6. All 6 Discovery Files + CORS
  console.log('\n6. Checking all 6 AI Discovery Files + CORS headers ...');
  const discoveryPaths = [
    '/.well-known/x402.json',
    '/.well-known/mcp.json',
    '/.well-known/agent.json',
    '/llms.txt',
    '/openapi.json',
    '/robots.txt',
  ];
  for (const p of discoveryPaths) {
    const r = await fetch(`${BASE_URL}${p}`);
    const cors = r.headers.get('access-control-allow-origin');
    const text = await r.text();
    assert(r.status === 200 && text.length > 20, `${p} returns HTTP 200`, `CORS=${cors || 'n/a'}`);
  }

  const agentCard = await (await fetch(`${BASE_URL}/.well-known/agent.json`)).json();
  const skillIds = (agentCard.skills || []).map((s) => s.id);
  assert(
    skillIds.includes('url-to-markdown') && skillIds.includes('web-reader'),
    'A2A agent.json declares url-to-markdown & web-reader skills',
    skillIds.join(', ')
  );

  const openApi = await (await fetch(`${BASE_URL}/openapi.json`)).json();
  assert(
    openApi.openapi === '3.1.0' && openApi.paths?.['/api/v1/extract']?.get?.['x-payment-required'] === true,
    'OpenAPI 3.1.0 declares x-payment-required: true'
  );

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
