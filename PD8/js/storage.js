import { cloneState, normalizeState } from "./models.js";

export const STORAGE_KEY = "aidaptable";

export function hasLocalStorage() {
  try {
    const probe = `${STORAGE_KEY}:probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloneState(state)));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save browser state." };
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not clear browser state." };
  }
}
