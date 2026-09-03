// weather.js
// Talks to Open-Meteo (https://open-meteo.com) — a free weather API that
// needs NO api key and NO account. You just call a URL with a lat/lon.
//
// This file's only job: given coordinates, return a clean array of
// { time: Date, tempF: number, pop: number, icon: string } objects,
// one per hour. app.js doesn't need to know anything about Open-Meteo's
// response shape — that's the point of wrapping it in a function.

// WMO "weather code" -> emoji. Open-Meteo returns a numeric code per hour
// from the WMO standard; this table is how we turn "61" into something
// a human (or this UI) can read at a glance.
const WEATHER_CODE_ICONS = {
  0: "☀️",              // clear sky
  1: "🌤", 2: "⛅", 3: "☁️", // mainly clear, partly cloudy, overcast
  45: "🌫", 48: "🌫",     // fog
  51: "🌦", 53: "🌦", 55: "🌦", // drizzle
  61: "🌧", 63: "🌧", 65: "🌧", // rain
  71: "🌨", 73: "🌨", 75: "🌨", // snow
  80: "🌧", 81: "🌧", 82: "🌧", // rain showers
  95: "⛈", 96: "⛈", 99: "⛈",  // thunderstorm
};

function iconFor(code) {
  return WEATHER_CODE_ICONS[code] ?? "❓";
}

// Same WMO codes, grouped more coarsely — this is what drives the page's
// color theme (the data-weather attribute in style.css). A theme only
// needs "is it basically clear/cloudy/rainy/snowy/foggy/stormy right now",
// not the full WMO detail the icon table uses.
const WEATHER_CODE_GROUPS = {
  0: "clear", 1: "clear",
  2: "cloudy", 3: "cloudy",
  45: "fog", 48: "fog",
  51: "rain", 53: "rain", 55: "rain", 61: "rain", 63: "rain", 65: "rain", 80: "rain", 81: "rain", 82: "rain",
  71: "snow", 73: "snow", 75: "snow", 77: "snow", 85: "snow", 86: "snow",
  95: "storm", 96: "storm", 99: "storm",
};

/** e.g. themeFor(61, false) -> "rain-night". Falls back to "cloudy" for any unmapped code. */
function themeFor(code, isDay) {
  const group = WEATHER_CODE_GROUPS[code] ?? "cloudy";
  return `${group}-${isDay ? "day" : "night"}`;
}

// Human-readable label for each WEATHER_CODE_GROUPS value — used for the
// header's current-conditions text (e.g. "72°F  Cloudy  H:81° L:68°").
const WEATHER_GROUP_LABELS = {
  clear: "Clear",
  cloudy: "Cloudy",
  fog: "Fog",
  rain: "Rain",
  snow: "Snow",
  storm: "Storm",
};

/**
 * Look up lat/lon for a US ZIP code via Zippopotam.us — another free,
 * key-free API, used only because Open-Meteo itself geocodes place
 * names, not postal codes.
 * @param {string} zip 5-digit US ZIP code
 * @returns {Promise<{lat: number, lon: number}>}
 */
async function geocodeZip(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
  if (!res.ok) {
    throw new Error(`ZIP lookup failed: ${res.status}`);
  }
  const data = await res.json();
  const place = data.places[0];
  return { lat: Number(place.latitude), lon: Number(place.longitude) };
}

function toDateParam(date) {
  // YYYY-MM-DD in LOCAL time. date.toISOString() would shift to UTC first,
  // which can land on the wrong day depending on timezone — this doesn't.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Fetch hourly forecast for a range of days at the given coordinates.
 * Open-Meteo's free forecast endpoint covers roughly 16 days out, which
 * comfortably fits "this week" plus a couple of "load next week" clicks.
 * @param {number} lat
 * @param {number} lon
 * @param {Date} startDate first day to include
 * @param {Date} endDate last day to include (inclusive)
 * @returns {Promise<Array<{time: Date, tempF: number, pop: number, icon: string, theme: string}>>}
 */
async function getHourlyWeather(lat, lon, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: "temperature_2m,precipitation_probability,weathercode,is_day",
    temperature_unit: "fahrenheit",
    timezone: "auto", // Open-Meteo converts timestamps to the location's local time for us
    start_date: toDateParam(startDate),
    end_date: toDateParam(endDate),
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) {
    throw new Error(`Weather request failed: ${res.status}`);
  }
  const data = await res.json();

  // Open-Meteo returns "parallel arrays": hourly.time[i] pairs with
  // hourly.temperature_2m[i], hourly.precipitation_probability[i], etc.
  // We zip them into one array of objects because that's much easier
  // to work with than juggling four arrays by index everywhere else.
  const { time, temperature_2m, precipitation_probability, weathercode, is_day } = data.hourly;

  return time.map((isoString, i) => ({
    time: new Date(isoString),
    tempF: Math.round(temperature_2m[i]),
    pop: precipitation_probability[i], // "probability of precipitation", 0-100
    icon: iconFor(weathercode[i]),
    theme: themeFor(weathercode[i], is_day[i] === 1),
    group: WEATHER_CODE_GROUPS[weathercode[i]] ?? "cloudy",
  }));
}
