// Service worker: deja el juego listo para jugar sin conexión.
// Archivos propios: primero la red (así llegan las actualizaciones) y si no hay, la copia guardada.
// Librerías del CDN (versión fija): primero la copia guardada.
const CACHE = 'kallpa-v2';
const CDN = 'https://cdn.jsdelivr.net/npm/';
const PROPIOS = [
  './', 'index.html', 'juego.js', 'musica.js', 'manifest.webmanifest', 'datos/niveles.json',
  ...[1, 2, 3, 4, 5, 6].map((n) => `datos/nivel${n}.glb`),
  'iconos/icono-192.png', 'iconos/icono-512.png',
];
const LIBRERIAS = [
  'three@0.169.0/build/three.module.js',
  'three@0.169.0/examples/jsm/loaders/GLTFLoader.js',
  'three@0.169.0/examples/jsm/loaders/DRACOLoader.js',
  'three@0.169.0/examples/jsm/utils/BufferGeometryUtils.js',
  'three@0.169.0/examples/jsm/libs/draco/gltf/draco_decoder.wasm',
  'three@0.169.0/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js',
  'three-mesh-bvh@0.8.3/build/index.module.js',
].map((r) => CDN + r);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...PROPIOS, ...LIBRERIAS])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const guardar = (r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
    return r;
  };
  if (req.url.startsWith(CDN)) {
    e.respondWith(caches.match(req).then((g) => g || fetch(req).then(guardar)));
  } else if (new URL(req.url).origin === location.origin) {
    e.respondWith(fetch(req).then(guardar).catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
