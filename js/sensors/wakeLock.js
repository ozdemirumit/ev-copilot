import { getState, patch, subscribe } from '../state.js';
import { toast } from '../ui/toast.js';

// Ekranı açık tutma: uygulama ön plandayken (navigasyon olsun olmasın) ekran varsayılan olarak açık tutulur, düğme yok.
// - Sayfa gizlenince (arka plan, sekme değişimi, kilit tuşu) kilit hemen bırakılır; ön plana dönünce yeniden alınır.
// - İşletim sistemi kilidi kendisi düşürürse (düşük pil, güç tasarrufu) buna uyulur: dokunuşlarda zorla yeniden istenmez;
//   yalnızca ön plana dönüşte ya da navigasyon başlarken bir kez denenir, sistem yine reddederse kabul edilir.
// - Bazı tarayıcılar (ör. iOS Safari) ilk isteği kullanıcı dokunuşu olmadan reddedebilir: hiç kilit alınamadıysa ilk dokunuşta yeniden denenir.
// - Android APK: MainActivity ön plandayken pencereye FLAG_KEEP_SCREEN_ON koyar ve EvrfKeepAwake eklentisiyle bunu bildirir;
//   o zaman web Wake Lock API'si gerekmez (WebView'da çoğu zaman yok).
// - Uyarı yalnızca navigasyon başlarken ekran açık tutulamıyorsa, navigasyon başına en çok bir kez gösterilir; gezinirken uyarı yok.
const UNSUPPORTED = 'Ekran açık tutulamıyor: bu tarayıcı desteklemiyor';
const FAILED = 'Ekran açık tutulamadı: cihazın ekran zaman aşımını uzatabilirsin';

let sentinel = null; // tarayıcının verdiği kilit; yalnızca o varken (ya da yerel bayrak varken) ekran gerçekten açık tutuluyor
let acquiring = null;
let navOn = false;
let warned = false;
let osDropped = false; // bu ön plan döneminde sistem kilidi kendisi bıraktı: dokunuşla zorlanmaz
let doc = null; // initWakeLock anındaki belge ve navigator (testte her örnek kendi taklidini tutar)
let nav = null;

const visible = () => doc?.visibilityState === 'visible';
const webSupported = () => !!nav?.wakeLock && typeof nav.wakeLock.request === 'function';

/** Android kabuğu (v0.99.58+ APK) ekranı yerel bayrakla açık tutuyor mu? Eski APK'da eklenti yoktur → false. */
export function nativeKeepAwake() {
  try {
    const cap = globalThis.Capacitor;
    return !!cap?.isNativePlatform?.() && cap.isPluginAvailable?.('EvrfKeepAwake') === true;
  } catch { return false; }
}

const held = () => !!sentinel || (visible() && nativeKeepAwake());

/** system.wakeLock yalnızca gerçekten açık tutulan ekranı yansıtır. */
function sync() {
  const h = held();
  if (getState('system').wakeLock !== h) patch('system', { wakeLock: h });
}

function warnInNav(text) {
  if (!navOn || warned) return;
  warned = true;
  toast(text, 4000);
}

function acquire() {
  if (sentinel || acquiring || !visible()) return acquiring;
  if (nativeKeepAwake()) { sync(); return null; }
  if (!webSupported()) { warnInNav(UNSUPPORTED); return null; }
  acquiring = Promise.resolve().then(() => nav.wakeLock.request('screen')).then((lock) => {
    if (!visible()) { lock.release().catch(() => {}); return; } // beklerken arka plana geçildi
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel !== lock) return; // kendimiz bıraktık
      sentinel = null;
      if (visible()) osDropped = true; // ön plandayken sistem bıraktı (güç tasarrufu vb.)
      sync();
    });
  }).catch(() => { warnInNav(FAILED); }).finally(() => { acquiring = null; sync(); });
  return acquiring;
}

function release() {
  const lock = sentinel;
  sentinel = null;
  sync();
  lock?.release().catch(() => {});
}

export function initWakeLock() {
  doc = document;
  nav = globalThis.navigator;
  subscribe('nav', (n) => {
    const on = !!n.active;
    if (on === navOn) return; // nav her saniye güncellenir
    navOn = on;
    if (!on) return; // navigasyon bitince kilit bırakılmaz: ön planda ekran açık kalır
    warned = false;
    if (!held()) acquire(); // genelde "Git" dokunuşuyla başlar: bir kez daha dene, olmazsa tek uyarı
  });
  doc.addEventListener('visibilitychange', () => {
    if (visible()) { osDropped = false; acquire(); }
    else release();
  });
  const onTouch = () => { if (!held() && !osDropped) acquire(); };
  doc.addEventListener('pointerdown', onTouch, { capture: true, passive: true });
  doc.addEventListener('keydown', onTouch, { capture: true, passive: true });
  acquire();
  sync();
}
