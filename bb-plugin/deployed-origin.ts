export const BB_DEPLOYED_ORIGIN_MESSAGE = "open-knowledge:deployed-origin";

export const DEPLOYED_ORIGIN_ERROR =
  "Deployed origin must be an http(s) URL without a username or password.";

export type BbDeployedOriginMessage =
  | { readonly type: typeof BB_DEPLOYED_ORIGIN_MESSAGE; readonly intent: "read" }
  | {
      readonly type: typeof BB_DEPLOYED_ORIGIN_MESSAGE;
      readonly intent: "set";
      readonly origin: string;
    }
  | {
      readonly type: typeof BB_DEPLOYED_ORIGIN_MESSAGE;
      readonly intent: "current";
      readonly origin: string;
    };

export function deployedOriginSetting(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(DEPLOYED_ORIGIN_ERROR);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(DEPLOYED_ORIGIN_ERROR);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(DEPLOYED_ORIGIN_ERROR);
  }
  if (url.origin === "null") throw new Error(DEPLOYED_ORIGIN_ERROR);
  return url.origin;
}

export function bbDeployedOriginRead(): BbDeployedOriginMessage {
  return { type: BB_DEPLOYED_ORIGIN_MESSAGE, intent: "read" };
}

export function bbDeployedOriginSet(origin: string): BbDeployedOriginMessage {
  return { type: BB_DEPLOYED_ORIGIN_MESSAGE, intent: "set", origin };
}

export function bbDeployedOriginCurrent(origin: string): BbDeployedOriginMessage {
  return { type: BB_DEPLOYED_ORIGIN_MESSAGE, intent: "current", origin };
}

export function readBbDeployedOriginMessage(data: unknown): BbDeployedOriginMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as { type?: unknown; intent?: unknown; origin?: unknown };
  if (record.type !== BB_DEPLOYED_ORIGIN_MESSAGE) return null;
  if (record.intent === "read") return bbDeployedOriginRead();
  if (record.intent === "set" && typeof record.origin === "string") {
    return bbDeployedOriginSet(record.origin);
  }
  if (record.intent === "current" && typeof record.origin === "string") {
    return bbDeployedOriginCurrent(record.origin);
  }
  return null;
}
