"""
CleanRead-402 LangChain / Python x402 Web Reader Tool
Zero API keys required. Supports free ?demo=true preview or Base Mainnet USDC X-Payment-Tx settlement.
"""

from __future__ import annotations
import json
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

CLEANREAD_BASE_URL = "https://cleanread-402.vercel.app"


def cleanread_extract(
    target_url: str,
    payment_tx: Optional[str] = None,
    demo: bool = False,
) -> Dict[str, Any]:
    params = {"url": target_url}
    if demo and not payment_tx:
        params["demo"] = "true"

    query = urllib.parse.urlencode(params)
    req_url = f"{CLEANREAD_BASE_URL}/api/v1/extract?{query}"
    headers = {"Accept": "application/json"}
    if payment_tx:
        headers["X-Payment-Tx"] = payment_tx

    req = urllib.request.Request(req_url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        if err.code == 402:
            invoice = json.loads(body)
            raise RuntimeError(
                f"HTTP 402 Payment Required: send {invoice.get('maxAmountRequired')} Base USDC units "
                f"($0.05) to {invoice.get('payTo')} and pass payment_tx='0x...' (or set demo=True)."
            ) from err
        raise RuntimeError(f"CleanRead HTTP {err.code}: {body}") from err


if __name__ == "__main__":
    preview = cleanread_extract("https://modelcontextprotocol.io/introduction", demo=True)
    print(f"Title: {preview['title']}")
    print(f"Tokens Saved: {preview['estimatedTokensSaved']}")
    print(preview["cleanMarkdown"])
