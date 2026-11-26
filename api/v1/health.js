import { CONFIG } from '../_lib/config.js';
import { setCorsHeaders, baseRpcCall } from '../_lib/x402.js';

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

  let baseRpc = { status: 'degraded', rpcUrl: null, latestBlock: null, latencyMs: null };
  try {
    const rpcCheck = await baseRpcCall('eth_blockNumber', [], 3500);
    baseRpc = {
      status: 'healthy',
      rpcUrl: rpcCheck.rpcUrl,
      latestBlock: parseInt(rpcCheck.result, 16),
      latencyMs: rpcCheck.latencyMs,
    };
  } catch (err) {
    baseRpc.error = err.message;
  }

  return res.status(200).json({
    service: CONFIG.serviceName,
    version: CONFIG.version,
    status: 'ok',
    protocols: ['x402', 'MCP 2024-11-05', 'A2A 1.0', 'OpenAPI 3.1'],
    network: CONFIG.network,
    chainId: CONFIG.chainId,
    payTo: CONFIG.payTo,
    asset: CONFIG.usdcContract,
    priceUsdc: '0.05',
    maxAmountRequired: '50000',
    antiReplayWindowSeconds: CONFIG.antiReplayWindowSec,
    demoPreviewChars: CONFIG.demoPreviewChars,
    baseRpc,
    endpoints: {
      extract: `${CONFIG.baseUrl}/api/v1/extract`,
      demo: `${CONFIG.baseUrl}/api/v1/extract?url=https://example.com&demo=true`,
      mcp: `${CONFIG.baseUrl}/mcp`,
      a2a: `${CONFIG.baseUrl}/a2a`,
      x402Manifest: `${CONFIG.baseUrl}/.well-known/x402.json`,
      mcpManifest: `${CONFIG.baseUrl}/.well-known/mcp.json`,
      agentCard: `${CONFIG.baseUrl}/.well-known/agent.json`,
      llmsTxt: `${CONFIG.baseUrl}/llms.txt`,
      openApi: `${CONFIG.baseUrl}/openapi.json`,
    },
    timestamp: new Date().toISOString(),
  });
}
