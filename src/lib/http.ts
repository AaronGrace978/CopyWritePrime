import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  if (inTauri()) {
    return tauriFetch(url, init) as Promise<Response>;
  }
  return fetch(url, init);
}
