// sw.js — Service Worker
//
// A service worker is a script the browser runs separately from the page,
// even when the page is closed. It's what lets a PWA control network
// requests, work offline, and receive push notifications. It's ALSO one of
// the two things (with manifest.json) Chrome/Edge require before they'll
// offer "Install App".
//
// Since this app assumes internet connectivity and doesn't need offline
// support, this file does the bare minimum: it registers itself and lets
// every request pass straight through to the network, unmodified.

self.addEventListener("install", () => {
  self.skipWaiting(); // activate this service worker as soon as it's installed
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim()); // take control of open pages immediately
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request)); // pass-through, no caching
});
