// ============================================================
// 🔔 FIREBASE MESSAGING — Service Worker (background push)
// ============================================================
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey:            'AIzaSyCIVshCdXm7Fp1X3kxGr5GZOF_jUBN3ChA',
    authDomain:        'chatmilhao.firebaseapp.com',
    projectId:         'chatmilhao',
    storageBucket:     'chatmilhao.firebasestorage.app',
    messagingSenderId: '411362756429',
    appId:             '1:411362756429:web:55059c1f443fe06a1bd904'
});

const messaging = firebase.messaging();

const APP_URL = 'https://delima20k.github.io/milionarios-da-leograf0.1.2/';

// ── Mensagem em background (app fechado / aba inativa) ──────
messaging.onBackgroundMessage(payload => {
    const n    = payload.notification || {};
    const data = payload.data         || {};
    const title = n.title || '🎱 Milionários da Leograf';
    const body  = n.body  || data.body || '';

    self.registration.showNotification(title, {
        body,
        icon:      APP_URL + 'icon-192.png',
        badge:     APP_URL + 'icon-192.png',
        tag:       'lotofacil-resultado',
        renotify:  true,
        vibrate:   [300, 100, 300, 100, 600],
        data:      { url: APP_URL }
    });
});

// ── Clique na notificação ────────────────────────────────────
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const target = e.notification.data?.url || APP_URL;
    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const c of list) {
                if (c.url.startsWith(APP_URL) && 'focus' in c) return c.focus();
            }
            return clients.openWindow(target);
        })
    );
});
