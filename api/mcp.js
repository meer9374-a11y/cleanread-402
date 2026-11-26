import { CONFIG } from './_lib/config.js';
import { setCorsHeaders, verifyBaseUsdcPayment, buildPaymentRequiredPayload } from './_lib/x402.js';
import { fetchAndExtractUrl } from './_lib/extractor.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'extract_clean_markdown',
    description:
      'Convert any messy webpage URL into clean, token-compressed, LLM-ready Markdown with boilerplate/ads stripped ($0.05 USDC / 50000 base units on Base Mainnet). Pass demo: true for a free 600-char preview + token savings stats, or payment_tx: "0x..." for full unthrottled output.',
    annotations: {
      title: 'Extract Clean LLM-Ready Markdown',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Target http:// or https:// webpage URL to extract and compress into Markdown.',
        },
        demo: {
          type: 'boolean',
          description: 'Set true for free 600-character preview + token compression telemetry (zero payment required).',
        },
        payment_tx: {
          type: 'string',
          description: 'Base Mainnet USDC transfer transaction hash (0x...) paying >= 0.05 USDC (50000 units) to 0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'batch_extract_links',
    description:
      'Extract clean, deduplicated absolute links ([{ text, url }]) and page title/compression summary from one or up to 3 webpage URLs ($0.05 USDC on Base Mainnet, or free top-10 preview with demo: true).',
    annotations: {
      title: 'Batch Extract Structured Webpage Links',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 3,
          description: 'List of 1 to 3 http:// or https:// webpage URLs to extract structured links from.',
        },
        demo: {
          type: 'boolean',
          description: 'Set true for free preview (1 URL, top 10 structured links).',
        },
        payment_tx: {
          type: 'string',
          description: 'Base Mainnet USDC transfer transaction hash (0x...) paying >= 0.05 USDC (50000 units) to 0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7.',
        },
      },
      required: ['urls'],
    },
  },
];

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      name: 'cleanread-402',
      displayName: CONFIG.serviceName,
      version: CONFIG.version,
      protocol: 'MCP JSON-RPC 2.0',
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: `${CONFIG.baseUrl}/mcp`,
      payTo: CONFIG.payTo,
      network: CONFIG.network,
      asset: CONFIG.usdcContract,
      maxAmountRequired: '50000',
      priceUsdc: '0.05',
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST for MCP JSON-RPC 2.0.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json(rpcError(null, -32700, 'Parse error: invalid JSON'));
    }
  }

  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return res.status(400).json(rpcError(body?.id ?? null, -32600, 'Invalid Request: expected JSON-RPC 2.0 payload'));
  }

  const { id = null, method, params = {} } = body;

  if (method === 'initialize') {
    return res.status(200).json(
      rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: 'cleanread-402',
          version: CONFIG.version,
        },
      })
    );
  }

  if (method === 'notifications/initialized') {
    if (id === null || id === undefined) {
      return res.status(202).end();
    }
    return res.status(200).json(rpcResult(id, {}));
  }

  if (method === 'ping') {
    return res.status(200).json(rpcResult(id, {}));
  }

  if (method === 'resources/list') {
    return res.status(200).json(
      rpcResult(id, {
        resources: [
          {
            uri: `${CONFIG.baseUrl}/llms.txt`,
            name: 'CleanRead-402 LLM Integration Guide',
            mimeType: 'text/markdown',
            description: 'Pricing, Base x402 settlement instructions, schemas, and examples.',
          },
        ],
      })
    );
  }

  if (method === 'prompts/list') {
    return res.status(200).json(
      rpcResult(id, {
        prompts: [
          {
            name: 'summarize_webpage_clean',
            description: 'Extract clean token-compressed Markdown from a URL and produce an executive summary.',
            arguments: [{ name: 'url', description: 'Webpage URL to read', required: true }],
          },
        ],
      })
    );
  }

  if (method === 'tools/list') {
    return res.status(200).json(rpcResult(id, { tools: TOOLS }));
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName !== 'extract_clean_markdown' && toolName !== 'batch_extract_links') {
      return res.status(200).json(rpcError(id, -32602, `Unknown tool: ${toolName}`));
    }

    const txHash = args.payment_tx || req.headers['x-payment-tx'] || req.headers['x-payment'] || null;
    const isDemo = args.demo === true || args.demo === 'true';

    let paymentInfo = null;
    if (txHash) {
      try {
        const verification = await verifyBaseUsdcPayment(String(txHash), '50000');
        if (!verification.ok) {
          return res.status(200).json(
            rpcResult(id, {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      status: 402,
                      ...buildPaymentRequiredPayload('/api/v1/extract', args.url || '', verification.reason),
                      verificationError: verification.code,
                    },
                    null,
                    2
                  ),
                },
              ],
            })
          );
        }
        paymentInfo = verification;
      } catch (err) {
        return res.status(200).json(
          rpcResult(id, {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
          })
        );
      }
    } else if (!isDemo) {
      return res.status(200).json(
        rpcResult(id, {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 402,
                  ...buildPaymentRequiredPayload('/api/v1/extract', args.url || (args.urls && args.urls[0]) || ''),
                },
                null,
                2
              ),
            },
          ],
        })
      );
    } else {
      paymentInfo = { demo: true, note: 'Free 600-char preview via Remote MCP. Pass payment_tx for full extraction.' };
    }

    try {
      if (toolName === 'extract_clean_markdown') {
        const targetUrl = args.url || CONFIG.defaultDemoUrl;
        const result = await fetchAndExtractUrl(targetUrl, { demo: isDemo });
        return res.status(200).json(
          rpcResult(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ...result, payment: paymentInfo }, null, 2),
              },
            ],
          })
        );
      }

      if (toolName === 'batch_extract_links') {
        const inputUrls = Array.isArray(args.urls) && args.urls.length > 0 ? args.urls : [CONFIG.defaultDemoUrl];
        const urlsToProcess = isDemo ? inputUrls.slice(0, 1) : inputUrls.slice(0, 3);
        const results = await Promise.all(
          urlsToProcess.map(async (u) => {
            const extracted = await fetchAndExtractUrl(u, { demo: isDemo });
            return {
              title: extracted.title,
              url: extracted.url,
              originalBytes: extracted.originalBytes,
              compressedBytes: extracted.compressedBytes,
              estimatedTokensSaved: extracted.estimatedTokensSaved,
              linksCount: extracted.linksCount,
              links: extracted.links,
            };
          })
        );
        return res.status(200).json(
          rpcResult(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    service: CONFIG.serviceName,
                    tool: 'batch_extract_links',
                    processedCount: results.length,
                    results,
                    payment: paymentInfo,
                  },
                  null,
                  2
                ),
              },
            ],
          })
        );
      }
    } catch (err) {
      return res.status(200).json(
        rpcResult(id, {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        })
      );
    }
  }

  return res.status(200).json(rpcError(id, -32601, `Method not found: ${method}`));
}
