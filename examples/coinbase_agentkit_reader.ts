/**
 * CleanRead-402 + Coinbase AgentKit Seamless x402 Web Reader Integration
 * Automatically negotiates HTTP 402 -> transfers 0.05 USDC on Base Mainnet -> retries with X-Payment-Tx.
 */

export interface CleanReadResponse {
  title: string;
  url: string;
  cleanMarkdown: string;
  originalBytes: number;
  compressedBytes: number;
  estimatedTokensSaved: number;
  compressionRatioPct: number;
  links: Array<{ text: string; url: string }>;
}

const CLEANREAD_ENDPOINT = 'https://cleanread-402.vercel.app/api/v1/extract';
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export async function readWebpageWithAgentKit(
  targetUrl: string,
  walletProvider: {
    sendTransaction: (tx: { to: `0x${string}`; data: `0x${string}` }) => Promise<`0x${string}`>;
  },
  encodeTransferData: (to: `0x${string}`, amount: bigint) => `0x${string}`
): Promise<CleanReadResponse> {
  const endpoint = `${CLEANREAD_ENDPOINT}?url=${encodeURIComponent(targetUrl)}`;

  // Step 1: Discover x402 invoice
  const initial = await fetch(endpoint);
  if (initial.status === 200) {
    return (await initial.json()) as CleanReadResponse;
  }
  if (initial.status !== 402) {
    throw new Error(`Unexpected CleanRead status: ${initial.status}`);
  }

  const invoice = await initial.json();
  const payTo = invoice.payTo as `0x${string}`;
  const usdcAsset = invoice.asset as `0x${string}`;
  const amountUnits = BigInt(invoice.maxAmountRequired); // 50000n ($0.05 USDC)

  // Step 2: Settle 0.05 USDC directly on Base L2
  const calldata = encodeTransferData(payTo, amountUnits);
  const txHash = await walletProvider.sendTransaction({
    to: usdcAsset,
    data: calldata,
  });

  // Step 3: Retry with stateless X-Payment-Tx proof
  const paidRes = await fetch(endpoint, {
    headers: { 'X-Payment-Tx': txHash },
  });
  if (!paidRes.ok) {
    throw new Error(`CleanRead paid call failed (${paidRes.status}): ${await paidRes.text()}`);
  }
  return (await paidRes.json()) as CleanReadResponse;
}
