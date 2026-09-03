// app.js
// The "conductor": for each day it wants to show, asks weather.js and
// calendar.js for data, then renders one "day block" (a Time / Weather /
// Calendar row) per day into #days-container. Clicking "Load next week"
// just fetches 7 more days and appends 7 more day blocks.
//
// The trickiest part here is the Calendar column: instead of one cell per
// hour, each day's calendar column is a single tall, `position: relative`
// container, and every event is one `position: absolute` block inside it,
// placed by converting its start/end time into a pixel offset. That's how
// an event can visually stretch across multiple hour rows instead of being
// stuck inside whichever hour it starts in.

const START_HOUR = 6;    // 6 AM — first row shown
const END_HOUR = 23;     // 11 PM — last row shown (visible window ends at midnight)
const VISIBLE_START_MIN = START_HOUR * 60;
const VISIBLE_END_MIN = (END_HOUR + 1) * 60;
const HOURS_SHOWN = END_HOUR - START_HOUR + 1;
const MIN_EVENT_HEIGHT_PX = 20; // so a 10-minute meeting is still clickable/readable

const FALLBACK_COORDS = { lat: 40.7128, lon: -74.006 }; // NYC, used if geolocation is denied

const statusEl = document.getElementById("status");
const signInBtn = document.getElementById("signin-btn");
const optionsBtn = document.getElementById("options-btn");
const settingsDialog = document.getElementById("settings-dialog");
const zipInput = document.getElementById("zip-input");
const daysContainer = document.getElementById("days-container");
const loadMoreBtn = document.getElementById("load-more-btn");

/** Each entry: { date: Date (midnight), weatherByHour: Map<hour, entry>, events: [] } */
let days = [];
let weeksLoaded = 0;
let cachedCoords = null; // resolved once per "session" (ZIP or geolocation), reused across week loads

function setStatus(text) {
  statusEl.textContent = text;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatHour(h) {
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:00 ${period}`;
}

function formatEventTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Reads the row height from CSS (--row-height) instead of hardcoding it
 *  twice, so the JS math and the CSS layout can never drift apart. */
function getRowHeightPx() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row-height"));
}

function buildDatesForWeek(weekIndex) {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate() + weekIndex * 7);
  return Array.from({ length: 7 }, (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
}

/**
 * Greedy interval-graph-coloring: give overlapping events distinct side-by-side
 * "columns" (like Google Calendar does) instead of stacking them on top of
 * each other. Events are grouped into clusters of mutually-touching events;
 * within a cluster, each event takes the first column whose previous
 * occupant has already ended. Mutates each event with `.col` and `.numCols`.
 */
function assignColumns(events) {
  events.sort((a, b) => a.clipStart - b.clipStart);

  let cluster = [];
  let clusterEnd = -Infinity;

  const finishCluster = () => {
    const columnEnds = [];
    for (const ev of cluster) {
      let col = columnEnds.findIndex((end) => end <= ev.clipStart);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(ev.clipEnd);
      } else {
        columnEnds[col] = ev.clipEnd;
      }
      ev.col = col;
    }
    for (const ev of cluster) ev.numCols = columnEnds.length;
  };

  for (const ev of events) {
    if (cluster.length && ev.clipStart >= clusterEnd) {
      finishCluster();
      cluster = [];
      clusterEnd = -Infinity;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.clipEnd);
  }
  if (cluster.length) finishCluster();
}

/** Turns one day's events into positioned <div class="event-block"> elements. */
function buildEventElements(events, rowHeight) {
  const laidOut = events
    .map((ev) => {
      const startMin = ev.start.getHours() * 60 + ev.start.getMinutes();
      let endMin = ev.end.getHours() * 60 + ev.end.getMinutes();
      if (endMin <= startMin) endMin = VISIBLE_END_MIN; // crosses midnight: clip at day's end
      return {
        ...ev,
        clipStart: Math.max(startMin, VISIBLE_START_MIN),
        clipEnd: Math.min(endMin, VISIBLE_END_MIN),
      };
    })
    // drop events that fall entirely outside the visible 6 AM-midnight window
    .filter((ev) => ev.clipEnd > VISIBLE_START_MIN && ev.clipStart < VISIBLE_END_MIN && ev.clipEnd > ev.clipStart);

  assignColumns(laidOut);

  return laidOut.map((ev) => {
    const top = ((ev.clipStart - VISIBLE_START_MIN) / 60) * rowHeight;
    const height = Math.max(MIN_EVENT_HEIGHT_PX, ((ev.clipEnd - ev.clipStart) / 60) * rowHeight);
    const widthPct = 100 / ev.numCols;
    const leftPct = ev.col * widthPct;

    const el = document.createElement("div");
    el.className = "event-block";
    el.style.top = `${top}px`;
    el.style.height = `${height}px`;
    el.style.left = `calc(${leftPct}% + 2px)`;
    el.style.width = `calc(${widthPct}% - 4px)`;
    el.title = `${formatEventTime(ev.start)}–${formatEventTime(ev.end)} ${ev.title}`;
    el.innerHTML = `<span class="event-time">${formatEventTime(ev.start)}</span> ${ev.title}`;
    return el;
  });
}

function buildDayBlock(day, rowHeight) {
  const today = new Date();
  const isToday = isSameDay(day.date, today);
  const currentHour = today.getHours();

  const section = document.createElement("section");
  section.className = "day-block" + (isToday ? " is-today" : "");

  const heading = document.createElement("h2");
  heading.className = "day-heading";
  heading.textContent = day.date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  section.appendChild(heading);

  const body = document.createElement("div");
  body.className = "day-body";

  const timeCol = document.createElement("div");
  timeCol.className = "time-col";
  const weatherCol = document.createElement("div");
  weatherCol.className = "weather-col";

  for (let h = START_HOUR; h <= END_HOUR; h++) {
    const isNow = isToday && h === currentHour;

    const timeCell = document.createElement("div");
    timeCell.className = "hour-cell time-cell" + (isNow ? " is-now" : "");
    timeCell.style.height = `${rowHeight}px`;
    timeCell.textContent = formatHour(h);
    timeCol.appendChild(timeCell);

    const weatherCell = document.createElement("div");
    weatherCell.className = "hour-cell weather-cell" + (isNow ? " is-now" : "");
    weatherCell.style.height = `${rowHeight}px`;
    const w = day.weatherByHour.get(h);
    weatherCell.innerHTML = w
      ? `${w.icon} <span class="temp">${w.tempF}°F</span>` + (w.pop > 0 ? `<span class="pop">${w.pop}%</span>` : "")
      : `<span class="muted">…</span>`;
    weatherCol.appendChild(weatherCell);
  }

  const calendarCol = document.createElement("div");
  calendarCol.className = "calendar-col";
  calendarCol.style.height = `${HOURS_SHOWN * rowHeight}px`;
  for (const el of buildEventElements(day.events, rowHeight)) {
    calendarCol.appendChild(el);
  }

  if (isToday) {
    const nowMin = today.getHours() * 60 + today.getMinutes();
    if (nowMin >= VISIBLE_START_MIN && nowMin <= VISIBLE_END_MIN) {
      const nowLine = document.createElement("div");
      nowLine.className = "now-line";
      nowLine.style.top = `${((nowMin - VISIBLE_START_MIN) / 60) * rowHeight}px`;
      calendarCol.appendChild(nowLine);
    }
  }

  body.append(timeCol, weatherCol, calendarCol);
  section.appendChild(body);
  return section;
}

function render() {
  const rowHeight = getRowHeightPx();
  daysContainer.innerHTML = "";
  for (const day of days) {
    daysContainer.appendChild(buildDayBlock(day, rowHeight));
  }
  applyCurrentWeatherTheme();
}

/**
 * Sets data-weather="rain-night" (etc.) on <html>, which style.css uses to
 * repaint the header gradient and accent color to match. Reads it off
 * *today's* entry for the current hour — if today hasn't loaded yet (or
 * that hour's forecast is missing), it just leaves whatever theme is
 * already set rather than resetting to a default.
 */
function applyCurrentWeatherTheme() {
  const today = days.find((d) => isSameDay(d.date, new Date()));
  const entry = today?.weatherByHour.get(new Date().getHours());
  if (!entry) return;

  document.documentElement.dataset.weather = entry.theme;

  // Keep the PWA's status-bar color (theme-color meta tag) matching too.
  // Read the value back from CSS rather than hardcoding it a second time
  // here, so style.css stays the one place these colors are defined.
  const headerColor = getComputedStyle(document.documentElement).getPropertyValue("--header-to").trim();
  document.querySelector('meta[name="theme-color"]').setAttribute("content", headerColor);
}

/** Wraps navigator.geolocation (callback-based) in a Promise so we can await it. */
function getBrowserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(FALLBACK_COORDS);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(FALLBACK_COORDS), // denied or unavailable -> fall back quietly
      { timeout: 5000 }
    );
  });
}

/** ZIP code from Options, if the user set one, takes priority over the browser's geolocation. */
async function resolveCoords() {
  const { zip } = getSettings();
  if (zip) {
    try {
      return await geocodeZip(zip);
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't look up ZIP ${zip}, using device location instead`);
    }
  }
  return getBrowserLocation();
}

async function loadCalendarForLoadedDays() {
  if (!isSignedIn() || days.length === 0) return;
  try {
    setStatus("Loading calendar…");
    // One request covers every day loaded so far, however many weeks that is.
    const events = await getEventsInRange(days[0].date, days[days.length - 1].date);
    for (const day of days) day.events = [];
    for (const ev of events) {
      const day = days.find((d) => isSameDay(d.date, ev.start));
      if (day) day.events.push(ev);
    }
  } catch (err) {
    console.error(err);
    setStatus("Calendar failed to load");
  }
}

/** Fetches and appends one more week's worth of days (weekIndex 0 = this week). */
async function loadWeek(weekIndex) {
  const dates = buildDatesForWeek(weekIndex);

  if (!cachedCoords) {
    setStatus("Getting location…");
    cachedCoords = await resolveCoords();
  }

  const weekDays = dates.map((date) => ({ date, weatherByHour: new Map(), events: [] }));

  setStatus("Loading weather…");
  try {
    const hourly = await getHourlyWeather(cachedCoords.lat, cachedCoords.lon, dates[0], dates[dates.length - 1]);
    for (const entry of hourly) {
      const day = weekDays.find((d) => isSameDay(d.date, entry.time));
      if (day) day.weatherByHour.set(entry.time.getHours(), entry);
    }
  } catch (err) {
    console.error(err);
    setStatus("Weather failed to load for that range");
  }

  days.push(...weekDays);
  weeksLoaded++;

  await loadCalendarForLoadedDays();
  render();
  setStatus("Up to date");
}

function setUpOptionsUI() {
  optionsBtn.addEventListener("click", () => {
    const { zip } = getSettings();
    zipInput.value = zip;
    settingsDialog.showModal(); // native modal: traps focus, dims the page, closes on Esc
  });

  // A <form method="dialog"> submission closes its dialog automatically and
  // copies whichever button was clicked's `value` into dialog.returnValue —
  // no manual event.preventDefault()/close() bookkeeping needed. We just
  // react afterward, via the dialog's "close" event.
  settingsDialog.addEventListener("close", async () => {
    if (settingsDialog.returnValue !== "save") return;

    saveSettings({ zip: zipInput.value.trim() });

    // A new ZIP means new coordinates, so simplest correct thing is to
    // start over from this week rather than trying to patch already-loaded weeks.
    cachedCoords = null;
    days = [];
    weeksLoaded = 0;
    loadMoreBtn.hidden = true;
    try {
      await loadWeek(0);
    } catch (err) {
      console.error(err);
      setStatus("Failed to reload");
    }
    loadMoreBtn.hidden = false;
  });
}

function setUpCalendarUI() {
  if (!isCalendarConfigured()) {
    setStatus("Weather loaded. (Calendar not configured — see README.md)");
    return;
  }
  initGoogleAuth();
  signInBtn.hidden = false;
  signInBtn.addEventListener("click", async () => {
    signInBtn.disabled = true;
    try {
      await signIn();
      signInBtn.hidden = true;
      await loadCalendarForLoadedDays();
      render();
      setStatus("Up to date");
    } catch (err) {
      console.error(err);
      setStatus("Google sign-in failed or was cancelled");
      signInBtn.disabled = false;
    }
  });
}

function setUpLoadMoreUI() {
  loadMoreBtn.addEventListener("click", async () => {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "Loading…";
    try {
      await loadWeek(weeksLoaded);
    } catch (err) {
      console.error(err);
      setStatus("Failed to load next week");
    }
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = "Load next week ↓";
  });
}

async function init() {
  setUpOptionsUI();
  setUpLoadMoreUI();
  try {
    await loadWeek(0);
  } catch (err) {
    console.error(err);
    setStatus("Failed to load");
  }
  loadMoreBtn.hidden = false;
  setUpCalendarUI();
}

init();

// Registering the service worker is what makes Chrome/Edge/etc. consider
// this an installable PWA (alongside manifest.json). We don't need real
// offline support, so sw.js just caches nothing and passes requests through.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW registration failed", err));
  });
}
