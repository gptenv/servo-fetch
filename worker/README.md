# servo-fetch Cloudflare Worker MCP server

This is the Worker deployment for the downstream fork. The native `servo-fetch` CLI remains available for full Servo rendering. The Worker build uses the platform `fetch()` API and a small Rust/WASM extraction core, because Cloudflare Workers cannot spawn the native Servo worker processes or use the native Tokio/network/filesystem stack.

## Setup

1. Install `wasm-pack` and Node.js 18+.
2. Run `npm install` in this directory.
3. Create a KV namespace and replace the placeholder ID in `wrangler.jsonc`.
4. Set the OAuth password with `npx wrangler secret put SHARED_PASSWORD`.
5. Run `npm run dev` or `npm run deploy`.

The MCP endpoint is `/mcp`. OAuth metadata, dynamic client registration, authorization, and token exchange are provided by `@cloudflare/workers-oauth-provider`; ChatGPT Apps should be configured with the deployed `/mcp` URL.

The Worker supports `fetch`, `batch_fetch`, `extract_json`, and `map`. Browser JavaScript execution and screenshots remain native-Servo capabilities and are intentionally not advertised by the Worker.
