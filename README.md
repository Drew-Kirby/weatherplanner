# Weather Schedule

A week at a time, one card per day: hour-by-hour weather next to your
Google Calendar events, with events drawn stretching across their real
start-to-end duration.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure: header, Options dialog, column headers, and the container days get appended into |
| `style.css` | Card/grid layout, colors, event positioning rules, the "now" line |
| `weather.js` | Fetches hourly forecast (and ZIP→coordinates) from free, key-less APIs |
| `calendar.js` | Google sign-in + fetches Calendar events for a date range |
| `app.js` | Builds day blocks, lays out events by time, wires weather/calendar in, handles "Load next week" |
| `manifest.json` | Makes the page installable as a PWA |
| `sw.js` | Minimal service worker (required for installability) |
| `settings.js` | Reads/writes the Options panel's ZIP code to `localStorage` |

## How a day is drawn (the part worth understanding)

Time and Weather are simple — one fixed-height `<div>` per hour, stacked in
a column. Calendar is not: an event needs to visually span from, say,
4:30 PM to 6:00 PM, crossing hour boundaries, which a "one cell per hour"
layout can't express.

The trick: the calendar column for a day is **one tall `position: relative`
box** (`.calendar-col` in `style.css`), sized to `numHours * rowHeight`.
Each event is a `position: absolute` `<div>` inside it, and `app.js`
computes its `top` and `height` in pixels directly from the event's
start/end time:

```
top    = (event start, in minutes since 6 AM) / 60 * rowHeight
height = (event duration in minutes)          / 60 * rowHeight
```

That's the same technique real calendar apps use for day/week views. Two
follow-on problems that technique creates, both handled in `app.js`:

- **Keeping JS math and CSS in sync.** The row height only needs to be
  defined once — as the CSS custom property `--row-height` in `style.css`
  — and `app.js`'s `getRowHeightPx()` reads it back via
  `getComputedStyle()` instead of hardcoding the number twice.
- **Overlapping events.** Two meetings at the same time can't both draw at
  `left: 0; width: 100%` without covering each other. `assignColumns()`
  in `app.js` is a small greedy graph-coloring algorithm: events are
  grouped into "clusters" of mutually-overlapping events, and each event
  claims the first side-by-side column whose previous occupant has
  already ended — same idea Google Calendar's own day view uses.

## Weather-driven theme

The header gradient and accent color change with the current hour's actual
forecast (e.g. a rainy evening gets a dark steel-blue header; a clear
afternoon gets sky blue). The mechanism is small and worth tracing:

1. `weather.js`'s `themeFor(code, isDay)` turns a WMO weather code plus the
   `is_day` flag Open-Meteo returns into a slug like `"rain-night"`, stored
   on every hourly entry alongside the emoji `icon` — same input, two
   different lookups.
2. `app.js`'s `applyCurrentWeatherTheme()` (called at the end of every
   `render()`) finds *today's* entry for *this* hour and sets
   `data-weather="rain-night"` on `<html>`.
3. `style.css` has one rule per slug — `:root[data-weather="rain-night"] { --header-from: ...; --accent: ...; }` — that overrides just those two
   variables. Everything else (page background, card surfaces, text) stays
   under light/dark's control, so contrast/readability never depends on
   the weather.

## Weeks

`app.js` keeps a `days` array (one entry per loaded day) instead of a
single day's worth of hours. `loadWeek(weekIndex)` fetches 7 days of
weather in **one request** (Open-Meteo accepts a `start_date`/`end_date`
range) and, if signed in, refetches Calendar events for the *entire*
loaded range in one request too — simpler than trying to merge
incrementally, and still just one extra network round-trip per "Load next
week" click.

## Options (⚙️ button)

- **ZIP code** — overrides browser geolocation for the weather column. Looked up via [Zippopotam.us](https://www.zippopotam.us/) (free, no key) to get lat/lon, since Open-Meteo itself only geocodes place names, not postal codes.

Saved in the browser's `localStorage`, so it's per-device and persists across reloads without needing a backend.

There's deliberately no field to type in a different calendar's address.
Calendar access always reads `primary` — whichever Google account you
actually sign in with — so the *only* way to see a different calendar is
to sign in as the account that owns it. Letting someone type in an
arbitrary email would either do nothing (the signed-in account has no
access to it) or, worse, invite trying other people's calendars without
their consent.

## Running it locally

Because this app calls `navigator.geolocation`, registers a service worker,
and does Google OAuth, it needs to be served over `http://` or `https://`
— opening `index.html` directly via `file://` will break all three.

From this folder, run one of:

```
npx serve .
# or
python -m http.server 8000
```

Then open the printed `http://localhost:...` URL in a browser.

## Setting up Google Calendar access

The weather column works immediately — Open-Meteo needs no signup. The
calendar column needs you to create your own OAuth credentials, because
it's reading a private calendar tied to your Google account:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (or pick an existing one).
2. **APIs & Services → Library** → search "Google Calendar API" → Enable.
3. **APIs & Services → OAuth consent screen** → choose "External" →
   fill in an app name and your email → add yourself as a test user
   (this app doesn't need Google review while it's just you testing it).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → Application type: **Web application**.
   - Under "Authorized JavaScript origins," add the URL you're serving
     from, e.g. `http://localhost:8000`.
   - You do NOT need a redirect URI for this — GIS's token flow used here
     works entirely via the JS origin.
5. Copy the generated **Client ID** and paste it into
   [calendar.js](calendar.js) as the value of `GOOGLE_CLIENT_ID`.
6. Reload the app and click "Connect Google Calendar."

Because the OAuth consent screen stays in "Testing" mode, tokens expire
after 7 days and only test users you explicitly added can sign in — that's
expected and fine for personal/learning use.

## Why these specific APIs

- **Open-Meteo** for weather: free, no API key, no account, no rate-limit
  paperwork — one less moving part while you're learning the rest of the
  app.
- **Google Identity Services (GIS) + Calendar API v3** for calendar: this
  is Google's current (2024+) client-side OAuth library, replacing the
  older deprecated `gapi.auth2`. The scope used,
  `calendar.readonly`, only grants read access — this app never writes to
  your calendar.
