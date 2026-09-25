import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import initWasm, { extract_json, extract_markdown } from "./wasm/servo_fetch_worker_core.js";

interface Env {
  OAUTH_KV: KVNamespace;
  SHARED_PASSWORD: string;
}

const MAX_HTML_BYTES = 4 * 1024 * 1024;
let wasmReady: Promise<unknown> | undefined;

function ensureWasm() {
  wasmReady ??= initWasm();
  return wasmReady;
}

function text(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function safeUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("only https URLs are allowed");
  return url;
}

async function fetchHtml(value: string): Promise<{ url: string; html: string }> {
  const url = safeUrl(value);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`upstream returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_HTML_BYTES) throw new Error("upstream HTML exceeds the 4 MiB limit");
  const html = await response.text();
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) throw new Error("upstream HTML exceeds the 4 MiB limit");
  return { url: response.url || url.href, html };
}

export class ServoFetchMcp extends McpAgent<Env> {
  server = new McpServer({ name: "servo-fetch", version: "0.14.2-worker" });

  async init() {
    this.server.registerTool("fetch", {
      description: "Fetch a public HTTPS page and extract readable Markdown. JavaScript-rendered pages are not executed in the Worker runtime.",
      inputSchema: { url: z.string().url(), selector: z.string().optional() }
    }, async ({ url, selector }) => {
      await ensureWasm();
      const page = await fetchHtml(url);
      return text(extract_markdown(page.html, page.url, selector));
    });

    this.server.registerTool("batch_fetch", {
      description: "Fetch up to 10 public HTTPS pages and extract readable Markdown.",
      inputSchema: { urls: z.array(z.string().url()).min(1).max(10) }
    }, async ({ urls }) => {
      await ensureWasm();
      const results = await Promise.all(urls.map(async (url) => {
        try {
          const page = await fetchHtml(url);
          return `${page.url}\n\n${extract_markdown(page.html, page.url, undefined)}`;
        } catch (error) {
          return `${url}\n\n[error] ${error instanceof Error ? error.message : String(error)}`;
        }
      }));
      return text(results.join("\n\n---\n\n"));
    });

    this.server.registerTool("extract_json", {
      description: "Fetch a public HTTPS page and return structured readable article JSON.",
      inputSchema: { url: z.string().url(), selector: z.string().optional() }
    }, async ({ url, selector }) => {
      await ensureWasm();
      const page = await fetchHtml(url);
      return text(extract_json(page.html, page.url, selector));
    });

    this.server.registerTool("map", {
      description: "Fetch one public HTTPS page and list same-origin links found in its HTML.",
      inputSchema: { url: z.string().url(), maxUrls: z.number().int().min(1).max(200).optional() }
    }, async ({ url, maxUrls = 100 }) => {
      const page = await fetchHtml(url);
      const origin = new URL(page.url).origin;
      const links = [...page.html.matchAll(/href=["']([^"']+)["']/gi)]
        .map((match) => { try { return new URL(match[1], page.url); } catch { return undefined; } })
        .filter((link): link is URL => link !== undefined && link.origin === origin)
        .map((link) => link.href);
      return text([...new Set(links)].slice(0, maxUrls).join("\n"));
    });
  }
}

function passwordPage(query: string, error = "") {
  return new Response(`<!doctype html><title>Authorize servo-fetch</title><form method="post" action="/authorize?${query}"><p>${error}</p><label>Access password <input name="password" type="password" required></label><button>Continue</button></form>`, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

const defaultHandler = {
  async fetch(request: Request, env: Env & { OAUTH_PROVIDER: OAuthHelpers }) {
    const url = new URL(request.url);
    if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });
    const provider = env.OAUTH_PROVIDER;
    const oauthRequest = await provider.parseAuthRequest(request);
    if (request.method === "GET") return passwordPage(url.searchParams.toString());
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
    const form = await request.formData();
    if (String(form.get("password") ?? "") !== env.SHARED_PASSWORD) return passwordPage(url.searchParams.toString(), "Invalid password");
    const { redirectTo } = await provider.completeAuthorization({
      request: oauthRequest,
      userId: "servo-fetch-user",
      scope: [],
      props: { userId: "servo-fetch-user" },
      metadata: undefined
    });
    return Response.redirect(redirectTo, 302);
  }
};

export default new OAuthProvider({
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  apiHandlers: { "/mcp": ServoFetchMcp.serve("/mcp") },
  defaultHandler
});
