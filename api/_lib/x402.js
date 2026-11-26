import { CONFIG } from './config.js';

export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Payment-Tx, X-Payment, Accept');
}

export function applyCachePolicy(res, mode) {
  if (mode === 'demo') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('X-Cache-Policy', 'cleanread-demo-edge-60s');
  } else if (mode === 'paid') {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Cache-Policy', 'paid-live-direct');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
}

export async function baseRpcCall(method, params = [], timeoutMs = 4500) {
  let lastError = null;
  for (const rpcUrl of CONFIG.rpcUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        lastError = new Error(`RPC HTTP ${response.status} from ${rpcUrl}`);
        continue;
      }
      const data = await response.json();
      if (data.error) {
        lastError = new Error(`RPC error from ${rpcUrl}: ${data.error.message || JSON.stringify(data.error)}`);
        continue;
      }
      return {
        result: data.result,
        rpcUrl,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
  }
  throw lastError || new Error('All Base Mainnet RPC endpoints failed');
}

export function buildPaymentRequiredPayload(endpointPath = '/api/v1/extract', targetUrl = '', reason = null) {
  const spec = CONFIG.pricing[endpointPath] || CONFIG.pricing['/api/v1/extract'];
  const resourceUrl = `${CONFIG.baseUrl}${endpointPath}${targetUrl ? `?url=${encodeURIComponent(targetUrl)}` : ''}`;
  const demoUrl = `${CONFIG.baseUrl}${endpointPath}?url=${encodeURIComponent(targetUrl || CONFIG.defaultDemoUrl)}&demo=true`;

  return {
    x402Version: 1,
    error:
      reason ||
      'Payment Required — transfer 0.05 USDC (50000 base units) on Base Mainnet to payTo and retry with X-Payment-Tx: <0x_tx_hash>, or append &demo=true for a free 600-char edge-cached preview.',
    payTo: CONFIG.payTo,
    network: CONFIG.network,
    chainId: CONFIG.chainId,
    asset: CONFIG.usdcContract,
    maxAmountRequired: spec.baseUnits,
    priceUsdc: spec.usdc,
    paymentHeader: 'X-Payment-Tx',
    antiReplayWindowSeconds: CONFIG.antiReplayWindowSec,
    accepts: [
      {
        scheme: 'exact',
        network: CONFIG.network,
        maxAmountRequired: spec.baseUnits,
        resource: resourceUrl,
        description: spec.description,
        mimeType: 'application/json',
        payTo: CONFIG.payTo,
        maxTimeoutSeconds: CONFIG.antiReplayWindowSec,
        asset: CONFIG.usdcContract,
        extra: {
          name: 'USD Coin',
          version: '2',
          decimals: 6,
          header: 'X-Payment-Tx',
        },
      },
    ],
    demoUrl,
  };
}

export async function verifyBaseUsdcPayment(txHash, requiredBaseUnits = '50000') {
  if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash.trim())) {
    return {
      ok: false,
      code: 'INVALID_TX_HASH',
      reason: 'X-Payment-Tx must be a valid 0x-prefixed 64-hex-character Base Mainnet transaction hash.',
    };
  }

  const normalizedTx = txHash.trim().toLowerCase();
  const receiptCall = await baseRpcCall('eth_getTransactionReceipt', [normalizedTx]);
  const receipt = receiptCall.result;

  if (!receipt) {
    return {
      ok: false,
      code: 'TX_NOT_FOUND',
      reason: 'Transaction receipt not found on Base Mainnet. Wait for 1 confirmation and retry.',
    };
  }

  if (receipt.status !== '0x1') {
    return {
      ok: false,
      code: 'TX_REVERTED',
      reason: `Transaction failed on-chain (status=${receipt.status}).`,
    };
  }

  const usdcLower = CONFIG.usdcContract.toLowerCase();
  const payToSuffix = CONFIG.payTo.toLowerCase().replace(/^0x/, '');
  const minUnits = BigInt(requiredBaseUnits);

  let paidUnits = 0n;
  let payer = null;

  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== usdcLower) continue;
    const topics = log.topics || [];
    if (topics.length < 3) continue;
    if ((topics[0] || '').toLowerCase() !== CONFIG.transferTopic) continue;
    const toTopic = (topics[2] || '').toLowerCase();
    if (!toTopic.endsWith(payToSuffix)) continue;

    const amount = BigInt(log.data || '0x0');
    paidUnits += amount;
    if (!payer && topics[1] && topics[1].length >= 42) {
      payer = '0x' + topics[1].slice(-40);
    }
  }

  if (paidUnits < minUnits) {
    return {
      ok: false,
      code: 'INSUFFICIENT_USDC',
      reason: `USDC Transfer to ${CONFIG.payTo} was ${paidUnits.toString()} base units; required >= ${minUnits.toString()} base units ($0.05 USDC).`,
    };
  }

  const blockCall = await baseRpcCall('eth_getBlockByNumber', [receipt.blockNumber, false]);
  const block = blockCall.result;
  if (!block || !block.timestamp) {
    return {
      ok: false,
      code: 'BLOCK_UNAVAILABLE',
      reason: 'Unable to fetch Base block timestamp for stateless anti-replay validation.',
    };
  }

  const blockTimestamp = parseInt(block.timestamp, 16);
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - blockTimestamp;

  if (ageSec > CONFIG.antiReplayWindowSec || ageSec < -60) {
    return {
      ok: false,
      code: 'REPLAY_WINDOW_EXPIRED',
      reason: `Payment transaction is ${ageSec}s old; stateless anti-replay requires block timestamp within the last ${CONFIG.antiReplayWindowSec} seconds.`,
    };
  }

  return {
    ok: true,
    txHash: normalizedTx,
    payer,
    paidBaseUnits: paidUnits.toString(),
    paidUsdc: (Number(paidUnits) / 1e6).toFixed(6),
    blockNumber: parseInt(receipt.blockNumber, 16),
    blockTimestamp,
    ageSeconds: ageSec,
    rpcUsed: receiptCall.rpcUrl,
    verificationLatencyMs: receiptCall.latencyMs + blockCall.latencyMs,
  };
}
