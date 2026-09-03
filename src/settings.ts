const KEY = "field.settings";

export type AppSettings = {
  apiKey: string;
  baseURL: string;
  model: string;
  /** When true, send a downscaled develop-preview JPEG with each agent turn. Default on. */
  sendPreview: boolean;
  /** Longest edge for the preview JPEG sent to the model. */
  visionMaxEdge: number;
};

export const defaultSettings = (): AppSettings => ({
  apiKey: "",
  baseURL: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  sendPreview: true,
  visionMaxEdge: 768,
});

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...defaultSettings(), ...parsed };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
