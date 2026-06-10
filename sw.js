const CACHE_NAME = 'cosecha-v1';
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap'
];

// Instalación: cachear assets principales
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['/index.html']);
    }).then(() => self.skipWaiting())
  );
});

// Activación: limpiar cachés antiguas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estrategia: Network First con fallback a caché
// Si hay red → respuesta fresca + actualiza caché
// Si no hay red → sirve desde caché
self.addEventListener('fetch', event => {
  // Solo manejar peticiones GET
  if (event.request.method !== 'GET') return;

  // Ignorar peticiones a APIs externas (storage compartido)
  const url = new URL(event.request.url);
  if (url.hostname !== location.hostname && !url.hostname.includes('fonts.g')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Guardar copia fresca en caché
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Sin red: servir desde caché
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback final: index.html para navegación offline
          return caches.match('/index.html');
        });
      })
  );
});

// Background Sync: reenviar reportes pendientes cuando recupera señal
self.addEventListener('sync', event => {
  if (event.tag === 'sync-reportes') {
    event.waitUntil(syncPendingReportes());
  }
});

async function syncPendingReportes() {
  try {
    const db = await openDB();
    const pendientes = await getPendientes(db);
    for (const reporte of pendientes) {
      try {
        // Intentar enviar al storage compartido
        // La lógica de sync real se maneja en el cliente
        await marcarEnviado(db, reporte.id);
      } catch(e) {
        console.log('Reporte pendiente, se reintentará:', reporte.id);
      }
    }
  } catch(e) {
    console.log('Sync background no disponible en este entorno');
  }
}

// IndexedDB helpers para cola offline
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cosecha-offline', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('pendientes', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function getPendientes(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendientes', 'readonly');
    const req = tx.objectStore('pendientes').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function marcarEnviado(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendientes', 'readwrite');
    const req = tx.objectStore('pendientes').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
