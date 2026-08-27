const KEY = "field.settings";

export type AppSettings = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export const defaultSettings = (): AppSettings => ({
  apiKey: "",
  baseURL: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
});

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
