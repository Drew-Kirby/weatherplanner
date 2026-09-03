// settings.js
// Reads/writes the one user-configurable option (ZIP code) to
// localStorage — a simple key/value store built into the browser that
// survives page reloads (but is specific to this browser on this device;
// it's not synced anywhere).
//
// Kept as its own tiny module so app.js doesn't need to know it's
// localStorage under the hood — it just calls getSettings()/saveSettings().
//
// Deliberately does NOT let you type in an arbitrary calendar to view —
// the only way to choose whose calendar is shown is signing in with that
// Google account, so this app can never be pointed at a calendar its
// current sign-in doesn't actually have access to.

const SETTINGS_KEY = "weather-schedule-settings";

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { zip: "" };
  } catch {
    return { zip: "" }; // corrupt or blocked storage -> just use defaults
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
