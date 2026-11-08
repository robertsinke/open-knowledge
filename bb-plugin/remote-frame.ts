import type { EditorOrigin } from "./server";

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

export function viewerNeedsPublishedFrame(pageHost: string): boolean {
  return !isLoopbackHost(pageHost);
}

export function localServerPort(origin: string): number | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isLoopbackHost(url.hostname) || url.port === "") return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

export function shareBaseForPage(
  listing: { url: string; nextUrl?: string },
  pageHost: string,
): string {
  if (pageHost.toLowerCase().includes(".next.") && listing.nextUrl) return listing.nextUrl;
  return listing.url;
}

export interface ProxyConsentLaunch {
  args: string[];
  env: { OK_ALLOW_EXTERNAL: "1" };
}

export function proxyConsentLaunch(port: number, shareUrl: string): ProxyConsentLaunch {
  return {
    args: ["--port", String(port), "--external-url", new URL(shareUrl).origin],
    env: { OK_ALLOW_EXTERNAL: "1" },
  };
}

export async function ensureProxyConsent(input: {
  port: number;
  shareUrl: string;
  probe(port: number, shareUrl: string): Promise<number>;
  stop(): Promise<void>;
  start(launch: ProxyConsentLaunch): Promise<void>;
}): Promise<void> {
  const status = await input.probe(input.port, input.shareUrl);
  if (status !== 403) return;
  await input.stop();
  await input.start(proxyConsentLaunch(input.port, input.shareUrl));
}

export function publishedFrame(local: EditorOrigin, shareUrl: string): EditorOrigin {
  const origin = new URL(shareUrl).origin;
  return {
    origin,
    editorUrl: `${origin}/bb.html`,
    mcpUrl: `${origin}/mcp`,
    source: local.source,
  };
}
