// calendar.js
// Talks to the Google Calendar API, authenticated via Google Identity
// Services (GIS) — the <script src="https://accounts.google.com/gsi/client">
// tag in index.html loads the `google` global this file uses.
//
// Unlike weather.js, this requires YOU to set up credentials first,
// because it's reading a private calendar, not public weather data.
// See README.md for the exact Google Cloud Console steps.
// Until you paste in a real CLIENT_ID below, calendar features stay
// disabled and the app just shows "Calendar not configured".

const GOOGLE_CLIENT_ID = "874979789418-fh62ivp1u9r41rc563sn5m9ko1djpkf8.apps.googleusercontent.com"; // <-- replace me
// calendar.readonly for the actual calendar data; userinfo.profile just for
// the header's "Hello, <name>" greeting after signing in — both are
// non-sensitive scopes, so neither triggers Google's app-verification review.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.profile";

let accessToken = null;
let tokenClient = null;

function isCalendarConfigured() {
  return !GOOGLE_CLIENT_ID.startsWith("YOUR_CLIENT_ID");
}

/**
 * Sets up the GIS "token client". This doesn't sign anyone in yet —
 * it just prepares the popup so signIn() can open it on a button click.
 * (Google requires the OAuth popup to be triggered by a real user
 * gesture like a click, so we can't just call this automatically.)
 */
function initGoogleAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: CALENDAR_SCOPE,
    callback: "", // set per-call in signIn(), see below
  });
}

/**
 * Opens the Google sign-in / consent popup. Resolves once we have an
 * access token, rejects if the user closes the popup or denies access.
 * @returns {Promise<void>}
 */
function signIn() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(response);
        return;
      }
      accessToken = response.access_token; // short-lived OAuth token, kept only in memory
      resolve();
    };
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

function isSignedIn() {
  return accessToken !== null;
}

/**
 * Fetches the signed-in user's basic profile (name, picture) for the
 * header's "Hello, <name>" greeting. Needs the userinfo.profile scope
 * requested alongside calendar.readonly in signIn().
 * @returns {Promise<{name: string, given_name: string, picture: string}>}
 */
async function getUserInfo() {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Userinfo request failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch events between two dates (inclusive of the full days they fall on),
 * ordered by start time. One call covers as many days as you like, which
 * is why "load next week" only needs one extra request, not one per day.
 *
 * Always reads "primary" — Google's alias for "whichever account just
 * signed in"'s own default calendar. There's deliberately no way to pass
 * a different calendar ID here: the only way to see a different calendar
 * is to sign in as the account that owns it, not by typing its address in.
 * @param {Date} startDate first day to include
 * @param {Date} endDate last day to include
 * @returns {Promise<Array<{title: string, start: Date, end: Date}>>}
 */
async function getEventsInRange(startDate, endDate) {
  const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const rangeEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);

  const params = new URLSearchParams({
    timeMin: rangeStart.toISOString(),
    timeMax: rangeEnd.toISOString(),
    singleEvents: "true", // expands recurring events into individual instances
    orderBy: "startTime",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Calendar request failed: ${res.status}`);
  }
  const data = await res.json();

  return (data.items ?? [])
    // All-day events come back as {start: {date: "2026-09-02"}} with no
    // time-of-day, so they don't fit an hourly row. We skip them here
    // rather than guessing which hour they "belong" to.
    .filter((item) => item.start?.dateTime)
    .map((item) => ({
      title: item.summary || "(no title)",
      start: new Date(item.start.dateTime),
      end: new Date(item.end.dateTime),
    }));
}
