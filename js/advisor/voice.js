import { getState } from '../state.js';
import { tr, locale } from '../i18n/index.js';
import { toast } from '../ui/toast.js';

const lastSpoken = new Map();
let lastErrAt = 0;
let voice = null;
const spokenListeners = new Set();
/** Gerçekten konuşulduğunda (anahtar bazında; metin verilmez) haber alır: saha testi sayaçları (js/ui/fieldTest.js). Dönüş: aboneliği kaldıran işlev. */
export function onSpoken(fn) { spokenListeners.add(fn); return () => spokenListeners.delete(fn); }
const spoken = (key) => spokenListeners.forEach((fn) => { try { fn(key); } catch { /* dinleyici hatası konuşmayı bozmaz */ } });
const issueListeners = new Set();
/** Ses motoru bir söylemi reddettiğinde (neden metni: 'not-allowed', 'synthesis-failed'...; konuşma metni verilmez) haber alır: istemci günlüğü (js/diag/clientLog.js). */
export function onVoiceIssue(fn) { issueListeners.add(fn); return () => issueListeners.delete(fn); }
const issue = (reason) => issueListeners.forEach((fn) => { try { fn(String(reason || 'unknown')); } catch { /* dinleyici hatası konuşmayı bozmaz */ } });

// iOS/Safari: ses motoru ilk söylemi yalnızca kullanıcı dokunuşu içinde başlatır; sonrasında dokunuşsuz uyarılar da konuşur.
// Eskiden yalnız boş, sıfır sesli bir söylem gönderiliyordu ve iPhone'da kilit açılmıyordu (ses ancak anahtar kapat/aç ile geliyordu).
// `unlocked` yalnızca söylem GERÇEKTEN başlayınca (onstart) true olur; olmadıkça her dokunuş yeniden dener.
let unlocked = false;
export const voiceUnlocked = () => unlocked;
// Safari: konuşma bitmeden çöp toplanan söylem sessizce düşer; bitene (ya da 2 dk geçene) dek referans tutulur.
const held = new Set();
function hold(u) {
  held.add(u);
  const drop = () => held.delete(u);
  u.onend = drop;
  setTimeout(drop, 120000);
}

// APK (Android WebView): güncel WebView'da window.speechSynthesis yok; Android'in yerel ses motoru Capacitor TextToSpeech eklentisiyle konuşturulur.
// Eklenti yoksa (eski APK ya da tarayıcı) null döner ve Web Speech API kullanılır.
const nativeTts = () => (globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.TextToSpeech : null) || null;

function pickVoice() {
  if (voice) return voice;
  const list = window.speechSynthesis?.getVoices() || [];
  const code = locale().slice(0, 2).toLowerCase();
  voice = list.find((v) => v.lang?.toLowerCase().startsWith(code)) || null;
  return voice;
}

function reportError(reason) {
  issue(reason);
  if (Date.now() - lastErrAt < 60000) return;
  lastErrAt = Date.now();
  toast(`Ses çıkmadı: ${reason || 'bilinmeyen hata'}`, 5000);
}

/** Süren konuşmayı kes (navigasyon bitti, ses kapatıldı). */
export function stopSpeech() {
  try { window.speechSynthesis?.cancel(); } catch { /* ses yok */ }
  nativeTts()?.stop?.().catch(() => {});
}

/** Web Speech API (APK'da yerel Android TTS) ile Türkçe sesli uyarı. Aynı `key` için `cooldownMs` içinde tekrar konuşmaz. */
export function speak(text, { key = text, cooldownMs = 60000, force = false, interrupt = false } = {}) {
  const synth = window.speechSynthesis;
  const nt = nativeTts();
  if ((!synth && !nt) || (!force && !getState('nav').voice)) return false;
  const now = Date.now();
  if (now - (lastSpoken.get(key) || 0) < cooldownMs) return false;
  lastSpoken.set(key, now);
  if (nt) { // queueStrategy 0 = öncekini kes, 1 = sıraya ekle; söz konuşma bitince çözülür, beklenmez
    nt.speak({ text: tr(text), lang: locale(), rate: 1.0, queueStrategy: interrupt ? 0 : 1 }).catch((e) => reportError(e?.message || String(e)));
    spoken(key);
    return true;
  }
  if (interrupt) synth.cancel(); // eski komut kuyruğa yığılmasın (yalnızca güncel talimat konuşulsun)
  else if (synth.paused) synth.resume(); // iOS: arka plan/kilit ekranı sonrası motor duraklamış kalabilir
  const u = new SpeechSynthesisUtterance(tr(text)); // sözlük seçili dile çevirir (Türkçede aynen)
  u.lang = locale();
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.0;
  hold(u);
  u.onstart = () => { unlocked = true; };
  u.onerror = (e) => { // ses motoru reddetti (ör. kullanıcı dokunuşu yok, motor yok, dil yok): sessizce kaybolmasın, dakikada bir bildir
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    reportError(e.error);
  };
  // cancel() hemen ardından gelen speak() bazı tarayıcılarda (Chrome) yutulur: kesme varsa kısa bekleyip konuş
  if (interrupt) setTimeout(() => synth.speak(u), 60); else synth.speak(u);
  spoken(key);
  return true;
}

if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => { voice = null; };

/** Kullanıcı dokunuşunun İÇİNDE (eşzamanlı) çağır: ses motorunu açar. Süren konuşmayı bozmaz; kilit açıldıysa ya da yerel (APK) motor varsa hiçbir şey yapmaz. */
export function unlockVoice() {
  const synth = window.speechSynthesis;
  if (!synth || unlocked || nativeTts()) return;
  try {
    if (synth.speaking || synth.pending) return;
    if (synth.paused) synth.resume();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.onstart = () => { unlocked = true; };
    u.onerror = (e) => { if (e.error && e.error !== 'interrupted' && e.error !== 'canceled') issue(e.error); };
    hold(u);
    synth.speak(u);
  } catch { /* ses yok */ }
}
if ('speechSynthesis' in window && typeof document !== 'undefined') { // ilk dokunuşta kilidi dene; açılınca dinleyici kalkar
  const onTap = () => { if (unlocked) document.removeEventListener('pointerdown', onTap, true); else unlockVoice(); };
  document.addEventListener('pointerdown', onTap, true);
}

/** Sesli uyarı denemesi (Ayarlar'daki "Sesi dene"): konuşmayı zorla başlatır ve motorun gerçekten başlayıp başlamadığını söyler. */
export function testVoice() {
  const nt = nativeTts();
  if (nt) { // yerel motor: konuşma bitince söz çözülür; reddedilirse nedeni döner
    const lang = locale();
    return Promise.all([
      nt.getSupportedVoices?.().then((r) => r.voices?.length ?? 0).catch(() => 0),
      nt.speak({ text: tr('Sesli uyarı denemesi.'), lang, rate: 1.0, queueStrategy: 0 }).then(() => ({ ok: true }), (e) => ({ ok: false, reason: e?.message || 'error' })),
    ]).then(([voices, r]) => ({ voices, lang, native: true, ...r }));
  }
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    let done = false;
    const end = (r) => { if (!done) { done = true; resolve({ voices: synth.getVoices().length, lang: locale(), ...r }); } };
    synth.cancel();
    const u = new SpeechSynthesisUtterance(tr('Sesli uyarı denemesi.'));
    u.lang = locale();
    const v = pickVoice();
    if (v) u.voice = v;
    u.onstart = () => { unlocked = true; end({ ok: true }); };
    u.onerror = (e) => end({ ok: false, reason: e.error || 'error' });
    hold(u);
    synth.speak(u);
    setTimeout(() => end({ ok: false, reason: 'timeout' }), 4000);
  });
}
