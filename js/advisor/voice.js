import { getState } from '../state.js';

const lastSpoken = new Map();
let voice = null;

function pickVoice() {
  if (voice) return voice;
  const list = window.speechSynthesis?.getVoices() || [];
  voice = list.find((v) => v.lang?.toLowerCase().startsWith('tr')) || null;
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
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'tr-TR';
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.0;
  synth.speak(u);
  return true;
}

if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => { voice = null; };
