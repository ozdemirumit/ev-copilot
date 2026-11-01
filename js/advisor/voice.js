import { getState } from '../state.js';
import { tr, locale } from '../i18n/index.js';
import { toast } from '../ui/toast.js';

const lastSpoken = new Map();
let lastErrAt = 0;
let voice = null;

function pickVoice() {
  if (voice) return voice;
  const list = window.speechSynthesis?.getVoices() || [];
  const code = locale().slice(0, 2).toLowerCase();
  voice = list.find((v) => v.lang?.toLowerCase().startsWith(code)) || null;
  return voice;
}

/** Web Speech API ile Türkçe sesli uyarı. Aynı `key` için `cooldownMs` içinde tekrar konuşmaz. */
export function speak(text, { key = text, cooldownMs = 60000, force = false, interrupt = false } = {}) {
  const synth = window.speechSynthesis;
  if (!synth || (!force && !getState('nav').voice)) return false;
  const now = Date.now();
  if (now - (lastSpoken.get(key) || 0) < cooldownMs) return false;
  lastSpoken.set(key, now);
  if (interrupt) synth.cancel(); // eski komut kuyruğa yığılmasın (yalnızca güncel talimat konuşulsun)
  const u = new SpeechSynthesisUtterance(tr(text)); // sözlük seçili dile çevirir (Türkçede aynen)
  u.lang = locale();
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.0;
  u.onerror = (e) => { // ses motoru reddetti (ör. kullanıcı dokunuşu yok, motor yok, dil yok): sessizce kaybolmasın, dakikada bir bildir
    if (e.error === 'interrupted' || e.error === 'canceled' || Date.now() - lastErrAt < 60000) return;
    lastErrAt = Date.now();
    toast(`Ses çıkmadı: ${e.error || 'bilinmeyen hata'}`, 5000);
  };
  // cancel() hemen ardından gelen speak() bazı tarayıcılarda (Chrome) yutulur: kesme varsa kısa bekleyip konuş
  if (interrupt) setTimeout(() => synth.speak(u), 60); else synth.speak(u);
  return true;
}

if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => { voice = null; };

/** Sesli uyarı denemesi (Ayarlar'daki "Sesi dene"): konuşmayı zorla başlatır ve motorun gerçekten başlayıp başlamadığını söyler. */
export function testVoice() {
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
