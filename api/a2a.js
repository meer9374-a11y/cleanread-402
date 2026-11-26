import { CONFIG } from './_lib/config.js';
import { setCorsHeaders, verifyBaseUsdcPayment, buildPaymentRequiredPayload } from './_lib/x402.js';
import { fetchAndExtractUrl } from './_lib/extractor.js';

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      protocol: 'A2A',
      agentCardUrl: `${CONFIG.baseUrl}/.well-known/agent.json`,
      endpoint: `${CONFIG.baseUrl}/a2a`,
      skills: ['url-to-markdown', 'web-reader'],
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST for A2A JSON-RPC 2.0.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
  }

  const { id = 1, method, params = {} } = body || {};

  if (method === 'tasks/send' || method === 'message/send') {
    const parts = params?.message?.parts || [];
    const textPart = parts.find((p) => p.type === 'text' || typeof p.text === 'string')?.text || '';
    const urlMatch = textPart.match(/https?:\/\/[^\s"'<>]+/i);
    const targetUrl = params?.url || (urlMatch ? urlMatch[0] : CONFIG.defaultDemoUrl);
    const isDemo = params?.demo === true || /\bdemo\b/i.test(textPart);
    const txHash = params?.payment_tx || req.headers['x-payment-tx'] || null;

    if (!txHash && !isDemo) {
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        result: {
          id: params?.id || `task-${Date.now()}`,
          status: { state: 'input-required' },
          artifacts: [
            {
              name: 'x402-payment-required',
              parts: [{ type: 'data', data: buildPaymentRequiredPayload('/api/v1/extract', targetUrl) }],
            },
          ],
        },
      });
    }

    if (txHash) {
      const verification = await verifyBaseUsdcPayment(String(txHash), '50000');
      if (!verification.ok) {
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            id: params?.id || `task-${Date.now()}`,
            status: { state: 'failed' },
            artifacts: [
              {
                name: 'x402-verification-error',
                parts: [{ type: 'data', data: buildPaymentRequiredPayload('/api/v1/extract', targetUrl, verification.reason) }],
              },
            ],
          },
        });
      }
    }

    try {
      const extracted = await fetchAndExtractUrl(targetUrl, { demo: !txHash });
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        result: {
          id: params?.id || `task-${Date.now()}`,
          status: { state: 'completed' },
          artifacts: [
            {
              name: 'clean-markdown',
              parts: [
                { type: 'text', text: extracted.cleanMarkdown },
                { type: 'data', data: extracted },
              ],
            },
          ],
        },
      });
    } catch (err) {
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message },
      });
    }
  }

  return res.status(200).json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unsupported A2A method: ${method}` },
  });
}
