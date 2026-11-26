export const CONFIG = {
  serviceName: 'CleanRead-402',
  slug: 'cleanread-402',
  version: '1.0.0',
  baseUrl: process.env.CLEANREAD_BASE_URL || 'https://cleanread-402.vercel.app',
  githubUrl: 'https://github.com/meer9374-a11y/cleanread-402',
  network: 'base',
  chainId: 8453,
  payTo: '0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7',
  usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  transferTopic: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  rpcUrls: [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
  ],
  antiReplayWindowSec: 600,
  demoPreviewChars: 600,
  defaultDemoUrl: 'https://modelcontextprotocol.io/introduction',
  pricing: {
    '/api/v1/extract': {
      usdc: '0.05',
      baseUnits: '50000',
      description: 'CleanRead-402 URL-to-Markdown & Token-Compression Engine ($0.05 USDC per call on Base Mainnet)',
    },
  },
};
