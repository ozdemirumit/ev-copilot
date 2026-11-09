import { getState, patch, subscribe } from '../state.js';
import { toast } from '../ui/toast.js';

// Ekranı açık tutma: navigasyon sürerken kendiliğinden istenir, bitince bırakılır (düğme yok).
// Desteklenmiyor ya da reddedildiyse navigasyon sürer; kullanıcıya navigasyon başına en çok bir kısa uyarı gösterilir.
const UNSUPPORTED = 'Ekran açık tutulamıyor: bu tarayıcı desteklemiyor';
const FAILED = 'Ekran açık tutulamadı: cihazın ekran zaman aşımını uzatabilirsin';

let sentinel = null; // tarayıcının verdiği kilit; yalnızca o varken ekran gerçekten açık tutuluyor
let acquiring = null;
let wanted = false; // navigasyon sürüyor: sekme gizlenince kilit düşer, istek kalır ve dönüşte yeniden alınır
let warned = false;

/** system.wakeLock yalnızca tutulan kilidi yansıtır. */
function sync() {
  const held = !!sentinel;
  if (getState('system').wakeLock !== held) patch('system', { wakeLock: held });
}

function warnOnce(text) {
  if (warned) return;
  warned = true;
  toast(text, 4000);
}

function acquire() {
  if (sentinel || acquiring || document.visibilityState !== 'visible') return acquiring;
  acquiring = navigator.wakeLock.request('screen').then((lock) => {
    if (!wanted) { lock.release().catch(() => {}); return; } // beklerken navigasyon bitti
    sentinel = lock;
    lock.addEventListener('release', () => { // sistem de bırakabilir (sekme gizlendi, düşük pil)
      if (sentinel === lock) { sentinel = null; sync(); }
    });
    sync();
  }).catch(() => { warnOnce(FAILED); }).finally(() => { acquiring = null; });
  return acquiring;
}

function release() {
  const lock = sentinel;
  sentinel = null;
  sync();
  lock?.release().catch(() => {});
}

export function initWakeLock() {
  const supported = 'wakeLock' in navigator;
  subscribe('nav', (nav) => {
    const on = !!nav.active;
    if (on === wanted) return; // nav her saniye güncellenir
    wanted = on;
    if (on) {
      warned = false;
      if (supported) acquire();
      else warnOnce(UNSUPPORTED);
    } else if (supported) release();
  });
  if (supported) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wanted) acquire();
    });
  }
  sync();
}
