// Garde l'appli en cache pour qu'elle marche sans Internet + rappels d'échéance
const CACHE = "starlink-clients-v6";
const FILES = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});

// ---- Rappels ----
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("slk", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) { const d = await idb(); return new Promise(r => { const q = d.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); }); }
async function kvSet(k, v) { const d = await idb(); return new Promise(r => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = r; t.onerror = r; }); }

async function checkReminders() {
  const list = (await kvGet("reminders")) || [];
  const old = (await kvGet("sent")) || {};
  const sent = {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const c of list) {
    if (!c.fin) continue;
    const [y, m, d] = c.fin.split("-").map(Number);
    const end = new Date(y, m - 1, d);
    const n = Math.round((end - today) / 86400000);
    const key = c.id + "|" + c.fin + "|" + n;
    if (old[key]) { sent[key] = 1; continue; }        // déjà prévenu pour ce jour
    if (n < 0 || n > 1) continue;                      // seulement la veille et le jour même
    const date = end.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" });
    const montant = (c.prixClient || 0).toLocaleString("fr-FR") + " F";
    try {
      await self.registration.showNotification(
        n === 0 ? "Expire aujourd'hui : " + c.nom : "Expire demain : " + c.nom,
        { body: "Abonnement Starlink jusqu'au " + date + ". Montant client : " + montant + ".",
          icon: "./icon-192.png", badge: "./icon-192.png", tag: key, data: { url: "./" } });
      sent[key] = 1;
    } catch (e) {}
  }
  await kvSet("sent", sent);
}

self.addEventListener("periodicsync", e => { if (e.tag === "rappels-starlink") e.waitUntil(checkReminders()); });
self.addEventListener("message", e => { if (e.data && e.data.type === "check") e.waitUntil(checkReminders()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ("focus" in w) return w.focus();
    return self.clients.openWindow("./");
  }));
});
