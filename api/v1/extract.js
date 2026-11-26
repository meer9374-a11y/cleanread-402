import { CONFIG } from '../_lib/config.js';
import {
  setCorsHeaders,
  applyCachePolicy,
  buildPaymentRequiredPayload,
  verifyBaseUsdcPayment,
} from '../_lib/x402.js';
import { fetchAndExtractUrl, validatePublicTargetUrl } from '../_lib/extractor.js';

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
  }

  let body = {};
  if (req.method === 'POST' && req.body) {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  }

  const isDemo =
    req.query?.demo === 'true' ||
    req.query?.demo === '1' ||
    body?.demo === true ||
    body?.demo === 'true';

  const rawTargetUrl = req.query?.url || body?.url || (isDemo ? CONFIG.defaultDemoUrl : '');
  const txHash =
    req.headers['x-payment-tx'] ||
    req.headers['x-payment'] ||
    req.query?.payment_tx ||
    body?.payment_tx ||
    null;

  // Validate URL format if provided (or if paid)
  if (rawTargetUrl) {
    const check = validatePublicTargetUrl(rawTargetUrl);
    if (!check.ok) {
      applyCachePolicy(res, 'none');
      return res.status(400).json({ error: check.error });
    }
  }

  // 1. Paid flow with X-Payment-Tx
  if (txHash) {
    if (!rawTargetUrl) {
      applyCachePolicy(res, 'none');
      return res.status(400).json({ error: 'Missing required ?url=<TARGET_URL> query parameter.' });
    }

    let verification;
    try {
      verification = await verifyBaseUsdcPayment(String(txHash), CONFIG.pricing['/api/v1/extract'].baseUnits);
    } catch (rpcErr) {
      applyCachePolicy(res, 'none');
      return res.status(502).json({
        error: 'Base Mainnet RPC verification temporarily unavailable',
        detail: rpcErr.message,
      });
    }

    if (!verification.ok) {
      applyCachePolicy(res, 'none');
      res.setHeader(
        'X-Payment-Required',
        `x402 network=base asset=${CONFIG.usdcContract} amount=50000 payTo=${CONFIG.payTo}`
      );
      return res.status(402).json({
        ...buildPaymentRequiredPayload('/api/v1/extract', rawTargetUrl, verification.reason),
        verificationError: verification.code,
      });
    }

    try {
      const extracted = await fetchAndExtractUrl(rawTargetUrl, { demo: false });
      applyCachePolicy(res, 'paid');
      return res.status(200).json({
        ...extracted,
        payment: verification,
      });
    } catch (extractErr) {
      applyCachePolicy(res, 'none');
      return res.status(extractErr.statusCode || 502).json({
        error: extractErr.message,
        payment: verification,
      });
    }
  }

  // 2. Free ?demo=true preview mode (600 chars + token savings stats, edge-cached 60s)
  if (isDemo) {
    try {
      const extracted = await fetchAndExtractUrl(rawTargetUrl || CONFIG.defaultDemoUrl, { demo: true });
      applyCachePolicy(res, 'demo');
      return res.status(200).json({
        ...extracted,
        payment: {
          ok: false,
          demo: true,
          priceUsdc: '0.05',
          maxAmountRequired: '50000',
          payTo: CONFIG.payTo,
          network: CONFIG.network,
          asset: CONFIG.usdcContract,
        },
      });
    } catch (extractErr) {
      applyCachePolicy(res, 'none');
      return res.status(extractErr.statusCode || 502).json({
        error: extractErr.message,
      });
    }
  }

  // 3. Unpaid request -> HTTP 402 Payment Required with standard x402 JSON
  applyCachePolicy(res, 'none');
  res.setHeader(
    'X-Payment-Required',
    `x402 network=base asset=${CONFIG.usdcContract} amount=50000 payTo=${CONFIG.payTo}`
  );
  return res.status(402).json(buildPaymentRequiredPayload('/api/v1/extract', rawTargetUrl));
}
