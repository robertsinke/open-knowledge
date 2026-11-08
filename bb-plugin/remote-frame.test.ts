import { describe, expect, it } from "vitest";
import {
  ensureProxyConsent,
  localServerPort,
  proxyConsentLaunch,
  publishedFrame,
  shareBaseForPage,
  viewerNeedsPublishedFrame,
} from "./remote-frame";

const local = {
  origin: "http://127.0.0.1:4173",
  editorUrl: "http://127.0.0.1:4173/bb.html",
  mcpUrl: "http://127.0.0.1:4173/mcp",
  source: "local" as const,
};

describe("remote editor frame", () => {
  it("keeps a loopback frame for a page on this machine", () => {
    expect(viewerNeedsPublishedFrame("localhost")).toBe(false);
    expect(viewerNeedsPublishedFrame("127.0.0.1")).toBe(false);
    expect(viewerNeedsPublishedFrame("[::1]")).toBe(false);
  });

  it("publishes a loopback editor on the connect share for a remote page", () => {
    expect(viewerNeedsPublishedFrame("inhouse.getbb.app")).toBe(true);
    expect(localServerPort(local.origin)).toBe(4173);
    expect(localServerPort("https://notes.example")).toBeNull();
    const frame = publishedFrame(
      local,
      shareBaseForPage(
        {
          url: "https://mac--4173.getbb.app",
          nextUrl: "https://mac--4173.next.getbb.app",
        },
        "inhouse.getbb.app",
      ),
    );
    expect(frame).toEqual({
      origin: "https://mac--4173.getbb.app",
      editorUrl: "https://mac--4173.getbb.app/bb.html",
      mcpUrl: "https://mac--4173.getbb.app/mcp",
      source: "local",
    });
  });

  it("restarts a refused editor with proxy consent on the same port", async () => {
    const started: unknown[] = [];
    let stopped = false;
    await ensureProxyConsent({
      port: 53923,
      shareUrl: "https://inhouse--53923.getbb.app/bb.html",
      probe: async () => 403,
      stop: async () => {
        stopped = true;
      },
      start: async (launch) => {
        started.push(launch);
      },
    });
    expect(stopped).toBe(true);
    expect(started).toEqual([
      proxyConsentLaunch(53923, "https://inhouse--53923.getbb.app/bb.html"),
    ]);
    expect(proxyConsentLaunch(53923, "https://inhouse--53923.getbb.app/bb.html")).toEqual({
      args: ["--port", "53923", "--external-url", "https://inhouse--53923.getbb.app"],
      env: { OK_ALLOW_EXTERNAL: "1" },
    });
  });

  it("leaves an admitted editor running", async () => {
    let stopped = false;
    await ensureProxyConsent({
      port: 53923,
      shareUrl: "https://inhouse--53923.getbb.app",
      probe: async () => 200,
      stop: async () => {
        stopped = true;
      },
      start: async () => {
        throw new Error("started");
      },
    });
    expect(stopped).toBe(false);
  });

  it("uses the next share when the page is on the next host", () => {
    expect(
      shareBaseForPage(
        {
          url: "https://mac--4173.getbb.app",
          nextUrl: "https://mac--4173.next.getbb.app",
        },
        "inhouse.next.getbb.app",
      ),
    ).toBe("https://mac--4173.next.getbb.app");
  });
});
