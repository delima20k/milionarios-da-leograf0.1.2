const CACHE_NAME = 'milionarios-v3.0';
const STATIC_CACHE = 'milionarios-static-v3.0';
const DYNAMIC_CACHE = 'milionarios-dynamic-v3.0';

// Recursos essenciais para cache
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './logo.svg'
];

// URLs da API que podem ser cacheadas
const API_CACHE_URLS = [
  /servicebus2\.caixa\.gov\.br\/portaldeloterias\/api\/lotofacil/
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
  
  // Estratégia para recursos estáticos (Cache First)
  if (CORE_ASSETS.some(asset => event.request.url.includes(asset.replace('./', '')))) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            console.log('[SW] Servindo do cache:', event.request.url);
            return cachedResponse;
          }
          
          // Se não estiver no cache, busca da rede e cacheia
          return fetch(event.request)
            .then(response => {
              const responseClone = response.clone();
              caches.open(STATIC_CACHE)
                .then(cache => {
                  cache.put(event.request, responseClone);
                });
              return response;
            });
        })
        .catch(() => {
          // Fallback para página offline se disponível
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        })
    );
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
    // Implementar sincronização de dados se necessário
    console.log('[SW] Sincronização concluída');
  } catch (error) {
    console.error('[SW] Erro na sincronização:', error);
  }
}

// Notificações Push (se implementar no futuro)
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: './logo.svg',
      badge: './logo.svg',
      tag: 'milionarios-notification',
      requireInteraction: true,
      actions: [
        {
          action: 'view',
          title: 'Ver Resultado'
        },
        {
          action: 'close',
          title: 'Fechar'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Clique em notificações
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('./')
    );
  }
});

// Log de informações do SW
console.log('[SW] Service Worker Milionários da Leograf carregado!');
console.log('[SW] Versão:', CACHE_NAME);
console.log('[SW] Recursos principais:', CORE_ASSETS);
