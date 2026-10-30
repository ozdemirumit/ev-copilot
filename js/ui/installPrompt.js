import { toast } from './toast.js';

/**
 * "Yükle" düğmesi: Chrome yüklenebilirlik koşullarını sağlayınca `beforeinstallprompt` gönderir;
 * düğme yalnızca o zaman görünür. Zaten uygulama olarak (standalone) açıldıysa hiç görünmez.
 */
export function initInstallPrompt() {
  const btn = document.getElementById('btn-install');
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!matchMedia('(display-mode: standalone)').matches) btn.classList.remove('hidden');
  });

  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    btn.classList.add('hidden');
    if (outcome === 'accepted') toast('Uygulama yükleniyor…');
  });

  window.addEventListener('appinstalled', () => {
    btn.classList.add('hidden');
    toast('Uygulama yüklendi');
  });
}
