self.addEventListener('install', (e) => {
  console.log('[Service Worker] Instalado');
});
self.addEventListener('fetch', (e) => {
  // Mantém a rede funcionando normalmente
});
