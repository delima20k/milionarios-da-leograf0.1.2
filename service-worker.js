// ── Firebase Messaging — background push handler ────────────────
// Deve estar no SW ativo (este arquivo), pois firebase-messaging-sw.js
// nunca se torna ativo: service-worker.js já ocupa o mesmo escopo com skipWaiting.
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

const _fcmMessaging = firebase.messaging();
const _FCM_URL = 'https://delima20k.github.io/milionarios-da-leograf0.1.2/';

function _fcmResolveTag(data) {
    if (data.chatType === 'chamada') return 'chamada-recebida';
    if (data.chatType === 'grupo')   return 'chat-grupo';
    if (data.chatType === 'privado') return 'chat-privado-' + (data.senderId || 'unknown');
    return 'lotofacil-resultado';
}

function _fcmResolveVibrate(data) {
    return data.chatType ? [200, 100, 200, 100, 400] : [300, 100, 300, 100, 600];
}

// Fallback para pushes data-only ou tipos futuros sem webpush.notification.
// Chat e Lotofácil usam webpush.notification → browser exibe automaticamente.
// Chamadas usam este handler para garantir requireInteraction + actions.
_fcmMessaging.onBackgroundMessage(payload => {
    const n    = payload.notification || {};
    const data = payload.data         || {};
    const title = n.title || data.title || '🎱 Milionários da Leograf';
    const body  = n.body  || data.body  || '';

    if (data.chatType === 'chamada') {
        return self.registration.showNotification(title, {
            body,
            icon:               _FCM_URL + 'icon-192.png',
            badge:              _FCM_URL + 'icon-192.png',
            tag:                'chamada-recebida',
            renotify:           true,
            requireInteraction: true,
            silent:             false,
            vibrate:            [500, 200, 500, 200, 500, 200, 500, 200, 500],
            actions: [
                { action: 'rejeitar', title: '❌ Recusar' },
                { action: 'aceitar',  title: '✅ Aceitar' }
            ],
            data: {
                url:        data.link || _FCM_URL,
                chatType:   'chamada',
                callId:     data.callId   || '',
                senderId:   data.senderId || '',
                senderName: data.senderName || ''
            }
        });
    }

    self.registration.showNotification(title, {
        body,
        icon:     _FCM_URL + 'icon-192.png',
        badge:    _FCM_URL + 'icon-192.png',
        tag:      _fcmResolveTag(data),
        renotify: true,
        vibrate:  _fcmResolveVibrate(data),
        data:     { url: data.link || _FCM_URL, chatType: data.chatType || '', senderId: data.senderId || '', senderName: data.senderName || '', concurso: data.concurso || '' }
    });
});
// ─────────────────────────────────────────────────────────────────

const STATIC_CACHE  = 'milionarios-static-v5.6';
const DYNAMIC_CACHE = 'milionarios-dynamic-v5.4';

// Recursos essenciais para cache
// Áudios (.mp3) removidos do cache: Range Requests (HTTP 206) são incompatíveis com cache.put()
// './' removido: asset.replace('./','') == '' → url.includes('') == sempre true (bug)
// firebase-messaging-sw.js removido: não é mais o SW ativo, FCM está embutido neste arquivo
const CORE_ASSETS = [
  './index.html',
  './style.css',
  './script.js',
  './chat.js',
  './manifest.json',
  './logo.svg'
];

// URLs da API que podem ser cacheadas
const API_CACHE_URLS = [
  /servicebus2\.caixa\.gov\.br\/portaldeloterias\/api\/lotofacil/
];

// Domínios que NUNCA devem ser cacheados — Firebase Auth, Firestore, Storage, etc.
// Respostas desses domínios são dinâmicas e dependem de tokens; cachear quebra a autenticação.
const NEVER_CACHE_DOMAINS = [
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firestore.googleapis.com',
  'firebasestorage.googleapis.com',
  'fcm.googleapis.com',
  'fcmregistrations.googleapis.com',
  'accounts.google.com',
  'oauth2.googleapis.com',
];

// Instalação do Service Worker
self.addEventListener('install', event => {
  console.log('[SW] Instalando Service Worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Cache estático aberto');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Recursos essenciais cacheados');
        self.skipWaiting(); // Força ativação imediata
      })
      .catch(err => {
        console.error('[SW] Erro ao cachear recursos:', err);
      })
  );
});

// Ativação do Service Worker
self.addEventListener('activate', event => {
  console.log('[SW] Ativando Service Worker...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            // Remove caches antigos
            if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
              console.log('[SW] Removendo cache antigo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service Worker ativado e pronto!');
        self.clients.claim(); // Assume controle imediato
      })
  );
});

// Interceptar requisições com estratégia Cache First para assets estáticos
// e Network First para API calls
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // Nunca cachear requisições POST, PUT, DELETE, PATCH nem extensões do browser
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // Domínios dinâmicos (Firebase Auth, Firestore, etc.) nunca devem ser interceptados
  if (NEVER_CACHE_DOMAINS.some(domain => requestUrl.hostname === domain)) return;

  // Estratégia para recursos estáticos (Cache First)
  // Compara pelo pathname final para evitar falsos positivos em outras origens
  const isJsOrCss = /\.(js|css)(\?.*)?$/.test(requestUrl.pathname);
  if (CORE_ASSETS.some(asset => requestUrl.pathname.endsWith(asset.replace('./', '')))) {
    // JS/CSS: stale-while-revalidate — serve cache imediatamente e atualiza em background
    if (isJsOrCss) {
      event.respondWith(
        caches.open(STATIC_CACHE).then(async cache => {
          const cached = await cache.match(event.request);
          const networkFetch = fetch(event.request).then(response => {
            if (response.status === 200) cache.put(event.request, response.clone());
            return response;
          }).catch(() => null);
          return cached || networkFetch;
        })
      );
    } else {
      event.respondWith(
        caches.match(event.request)
          .then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            return fetch(event.request)
              .then(response => {
                if (response.status === 200) {
                  const responseClone = response.clone();
                  caches.open(STATIC_CACHE)
                    .then(cache => cache.put(event.request, responseClone));
                }
                return response;
              });
          })
          .catch(() => {
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
          })
      );
    }
  }
  
  // Estratégia para chamadas da API (Network First com cache de backup)
  else if (API_CACHE_URLS.some(pattern => pattern.test(event.request.url))) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Se a resposta for bem-sucedida, armazena no cache dinâmico
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE)
              .then(cache => {
                cache.put(event.request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          // Se a rede falhar, tenta buscar do cache dinâmico
          console.log('[SW] Rede falhou, buscando API do cache...');
          return caches.match(event.request);
        })
    );
  }
  
  // Para outras requisições, estratégia padrão
  else {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match(event.request);
        })
    );
  }
});

// Sincronização em background (quando a rede voltar)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('[SW] Executando sincronização em background...');
    event.waitUntil(
      // Aqui você pode implementar lógica para sincronizar dados
      // quando a conexão voltar
      doBackgroundSync()
    );
  }
});

async function doBackgroundSync() {
  try {
    // Sinaliza todos os clientes abertos para drenar a fila offline (IndexedDB)
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    allClients.forEach(c => c.postMessage({ type: 'DRAIN_QUEUE' }));
    console.log(`[SW] Background Sync → DRAIN_QUEUE enviado para ${allClients.length} cliente(s)`);
  } catch (error) {
    console.error('[SW] Erro na sincronização:', error);
  }
}

// Clique em notificações — foca janela existente ou abre nova, depois roteia
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const notifData  = event.notification.data || {};
  const target     = notifData.url       || _FCM_URL;
  const chatType   = notifData.chatType  || '';
  const senderId   = notifData.senderId  || '';
  const senderName = notifData.senderName || '';
  const concurso   = notifData.concurso  || '';
  const callId     = notifData.callId    || '';
  const action     = event.action        || '';

  // ── Chamada: botões Aceitar / Rejeitar ──────────────────────
  if (chatType === 'chamada') {
    const msg = action === 'rejeitar'
      ? { type: 'REJECT_CALL', callId }
      : { type: 'ACCEPT_CALL', callId, senderName };
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
        let client = list.find(c => c.url.startsWith(_FCM_URL) && 'focus' in c);
        if (client) {
          await client.focus();
        } else {
          client = await clients.openWindow(target);
          // Aguarda o cliente carregar antes de postar a mensagem
          await new Promise(res => setTimeout(res, 1500));
        }
        client?.postMessage(msg);
      })
    );
    return;
  }

  // ── Chat / Lotofácil ─────────────────────────────────────────
  let navMsg = null;
  if (chatType === 'lotofacil') {
    navMsg = { type: 'NAVIGATE_TO_LOTOFACIL', concurso };
  } else if (chatType) {
    navMsg = { type: 'NAVIGATE_TO_CHAT', chatType, senderId, senderName };
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
      let client = list.find(c => c.url.startsWith(_FCM_URL) && 'focus' in c);
      if (client) {
        await client.focus();
      } else {
        client = await clients.openWindow(target);
      }
      if (navMsg && client) client.postMessage(navMsg);
    })
  );
});

// Log de informações do SW
console.log('[SW] Service Worker Milionários da Leograf carregado!');
console.log('[SW] Versão:', STATIC_CACHE);
console.log('[SW] Recursos principais:', CORE_ASSETS);
