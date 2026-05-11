// ============================================================
// 🔔 FIREBASE MESSAGING — Service Worker (background push) v2
// Tags separadas por tipo: chat-grupo, chat-privado-{uid}, lotofacil-resultado
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

// ── Determina tag correta por tipo de notificação ────────────
function resolveTag(data) {
    if (data.chatType === 'grupo')   return 'chat-grupo';
    if (data.chatType === 'privado') return 'chat-privado-' + (data.senderId || 'unknown');
    return 'lotofacil-resultado';
}

function resolveVibrate(data) {
    if (data.chatType) return [200, 100, 200, 100, 400];
    return [300, 100, 300, 100, 600];
}

// ── Mensagem em background (app fechado / aba inativa) ───────
messaging.onBackgroundMessage(payload => {
    const data  = payload.data || {};
    // Mensagens data-only: título e corpo chegam em data.title / data.body
    const title = data.title || '🎱 Milionários da Leograf';
    const body  = data.body  || '';
    const tag   = resolveTag(data);
    const url   = data.link || APP_URL;

    console.log('[FCM-SW] Background message recebida. tag:', tag, 'tipo:', data.chatType || 'lotofacil');

    self.registration.showNotification(title, {
        body,
        icon:      APP_URL + 'icon-192.png',
        badge:     APP_URL + 'icon-192.png',
        tag,
        renotify:  true,
        vibrate:   resolveVibrate(data),
        data:      { url, chatType: data.chatType || '', senderId: data.senderId || '', senderName: data.senderName || '', concurso: data.concurso || '' }
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
