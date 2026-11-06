export const BB_SETTINGS_MESSAGE = "open-knowledge:bb-settings";

export function bbSettingsOpen(): { type: typeof BB_SETTINGS_MESSAGE } {
  return { type: BB_SETTINGS_MESSAGE };
}

export function readBbSettingsMessage(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === BB_SETTINGS_MESSAGE
  );
}

export function bbPluginSettingsPath(pluginId: string): string {
  return `/settings/plugins/${encodeURIComponent(pluginId)}`;
}

export function bbSettingsFrameUrl(editorUrl: string): string {
  const url = new URL(editorUrl);
  url.searchParams.set("bb-settings", "1");
  url.hash = "settings";
  return url.toString();
}
