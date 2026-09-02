// settings.js
// Reads/writes the two user-configurable options (ZIP code, calendar
// email) to localStorage — a simple key/value store built into the
// browser that survives page reloads (but is specific to this browser
// on this device; it's not synced anywhere).
//
// Kept as its own tiny module so app.js doesn't need to know it's
// localStorage under the hood — it just calls getSettings()/saveSettings().

const SETTINGS_KEY = "weather-schedule-settings";

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { zip: "", calendarId: "" };
  } catch {
    return { zip: "", calendarId: "" }; // corrupt or blocked storage -> just use defaults
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
