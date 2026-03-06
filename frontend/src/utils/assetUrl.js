const API_BASE = process.env.REACT_APP_API_URL || "/api";

export function resolveAssetUrl(rawUrl) {
  if (!rawUrl) return null;
  const input = String(rawUrl).trim();
  if (!input) return null;
  if (/^(https?:|data:|blob:)/i.test(input)) return input;

  const path = input.startsWith("/") ? input : `/${input}`;

  try {
    if (/^https?:\/\//i.test(API_BASE)) {
      const api = new URL(API_BASE);
      return `${api.origin}${path}`;
    }
  } catch (_) {
    // fallback to same-origin path
  }

  return path;
}
