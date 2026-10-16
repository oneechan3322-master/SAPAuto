self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>غير متصل</title><body style="font-family:sans-serif;background:#0b1118;color:#eaf0f5;padding:2rem"><h1>لا يوجد اتصال بالخادم</h1><p>اتصل بشبكة المكتب ثم أعد المحاولة.</p></body></html>',
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
  )))
})
