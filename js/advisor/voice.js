import { getState } from '../state.js';
import { tr, locale } from '../i18n/index.js';
import { toast } from '../ui/toast.js';

const lastSpoken = new Map();
let lastErrAt = 0;
let voice = null;

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
    return true;
  }
  if (interrupt) synth.cancel(); // eski komut kuyruğa yığılmasın (yalnızca güncel talimat konuşulsun)
  const u = new SpeechSynthesisUtterance(tr(text)); // sözlük seçili dile çevirir (Türkçede aynen)
  u.lang = locale();
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.0;
  u.onerror = (e) => { // ses motoru reddetti (ör. kullanıcı dokunuşu yok, motor yok, dil yok): sessizce kaybolmasın, dakikada bir bildir
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    reportError(e.error);
  };
  // cancel() hemen ardından gelen speak() bazı tarayıcılarda (Chrome) yutulur: kesme varsa kısa bekleyip konuş
  if (interrupt) setTimeout(() => synth.speak(u), 60); else synth.speak(u);
  return true;
}

if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => { voice = null; };

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
    u.onstart = () => end({ ok: true });
    u.onerror = (e) => end({ ok: false, reason: e.error || 'error' });
    synth.speak(u);
    setTimeout(() => end({ ok: false, reason: 'timeout' }), 4000);
  });
}
