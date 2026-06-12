// Hours Tracker Service Worker — offline cache + clock & schedule reminders
const REMINDER_INTERVAL_MS = 60 * 60 * 1000; // check every hour
const SCHEDULE_CHECK_MS = 30 * 1000; // check schedule every 30s

// ─── Offline cache ───
const CACHE_NAME = 'ht-app-v1';
const PRECACHE_URLS = ['./', './index.html', './app.js', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}) // precache failure shouldn't block install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('ht-app-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GET requests:
// serve from cache immediately, refresh the cache in the background.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached); // offline: fall back to cache
        return cached || network;
      })
    )
  );
});

let reminderTimer = null;
let scheduleTimer = null;
let currentSchedule = null;
let isClockedIn = false;
let clockInISO = null;

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'CLOCK_STATE') {
    isClockedIn = !!data.clockedIn;
    clockInISO = data.clockInISO || null;

    if (isClockedIn && clockInISO) {
      scheduleReminder(clockInISO, data.missedClockOutHours || 14);
    } else {
      cancelReminder();
    }
  }

  if (data.type === 'SCHEDULE_UPDATE') {
    currentSchedule = data.schedule || null;
    isClockedIn = !!data.clockedIn;
    clockInISO = data.clockInISO || null;
    caches.delete('ht-notif-state'); // Reset blockers on schedule update
    startScheduleCheck();
  }
});

function scheduleReminder(clockInISO, missedHours) {
  cancelReminder();
  reminderTimer = setInterval(() => {
    const elapsed = (Date.now() - new Date(clockInISO).getTime()) / 3600000;
    const hours = Math.floor(elapsed);

    if (elapsed >= missedHours) {
      showNotification(
        'Missed clock-out?',
        `You have been clocked in for ${hours} hours. Did you forget to clock out?`
      );
      cancelReminder();
      return;
    }

    // Remind at 8h and every 2h after
    if (hours >= 8 && hours % 2 === 0) {
      showNotification(
        'Still clocked in',
        `You have been working for ${hours} hours. Remember to take breaks.`
      );
    }
  }, REMINDER_INTERVAL_MS);
}

function cancelReminder() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

function startScheduleCheck() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = setInterval(checkSchedule, SCHEDULE_CHECK_MS);
}

async function checkSchedule() {
  if (!currentSchedule) return;
  const now = new Date();
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const todaySched = currentSchedule[dayNames[now.getDay()]];
  if (!todaySched || !todaySched.enabled) return;

  const [sh, sm] = todaySched.start.split(':').map(Number);
  const [eh, em] = todaySched.end.split(':').map(Number);
  const schedStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0);
  const schedEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0);

  const minsUntilStart = Math.floor((schedStart - now) / 60000);
  const minsSinceEnd = Math.floor((now - schedEnd) / 60000);
  
  const cache = await caches.open('ht-notif-state');
  const res = await cache.match('/lastNotifTag');
  let persistentTag = res ? await res.text() : null;

  // Clock-in notification: 10 min before shift, not clocked in
  if (minsUntilStart > 0 && minsUntilStart <= 10 && !isClockedIn) {
    const tag = `clock-in-${now.toDateString()}`;
    if (persistentTag !== tag) {
      await cache.put('/lastNotifTag', new Response(tag));
      showNotification('Shift starting soon', `Your shift starts in ${minsUntilStart} minute${minsUntilStart !== 1 ? 's' : ''}. Don’t forget to clock in!`);
    }
  }

  // Clock-out notification: 10 min after shift end, still clocked in
  if (minsSinceEnd >= 10 && minsSinceEnd <= 12 && isClockedIn) {
    const tag = `clock-out-${now.toDateString()}`;
    if (persistentTag !== tag) {
      await cache.put('/lastNotifTag', new Response(tag));
      showNotification('Shift ended', `Your shift ended ${minsSinceEnd} minutes ago. You are still clocked in.`);
    }
  }
}

function showNotification(title, body) {
  self.registration.showNotification(title, {
    body,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏱️</text></svg>',
    tag: 'ht-' + title.replace(/\s/g, '-').toLowerCase(),
    renotify: true
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
