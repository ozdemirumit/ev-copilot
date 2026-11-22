// Ses motoru kilidi (iOS/Safari) testi: js/advisor/voice.js unlockVoice / onVoiceIssue / söylem tutucu + navigator.js bağlantısı.
// Düz node, çevrimdışı; sahte window/document/speechSynthesis. Kullanım: node scripts/test-voice-unlock.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

// ---- sahte tarayıcı ----
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const listeners = [];
globalThis.document = {
  addEventListener: (t, fn, cap) => listeners.push({ t, fn, cap }),
  removeEventListener: (t, fn) => { const i = listeners.findIndex((l) => l.t === t && l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
  getElementById: () => ({ classList: { add() {}, remove() {} }, set textContent(_v) {} }),
};
class FakeUtterance { constructor(text) { this.text = text; this.volume = 1; this.lang = ''; } }
globalThis.SpeechSynthesisUtterance = FakeUtterance;
const synth = { spoken: [], speaking: false, pending: false, paused: false, resumed: 0, cancels: 0,
  speak(u) { this.spoken.push(u); }, cancel() { this.cancels++; }, resume() { this.resumed++; this.paused = false; }, getVoices: () => [] };
globalThis.window = globalThis; // 'speechSynthesis' in window
globalThis.speechSynthesis = synth;

const V = await import('../js/advisor/voice.js');
const tap = () => listeners.filter((l) => l.t === 'pointerdown').map((l) => l.fn).forEach((fn) => fn());

// A) ilk dokunuşta sessiz kilit söylemi gönderilir (gerçek, tek boşluk, ses 0) ve kilit başlamadan açılmış sayılmaz
ok('A açılışta kilit kapalı', V.voiceUnlocked() === false);
ok('A ilk dokunuş dinleyicisi kayıtlı (yakalama aşaması)', listeners.some((l) => l.t === 'pointerdown' && l.cap === true));
tap();
ok('A dokunuşta tek söylem gönderildi', synth.spoken.length === 1);
ok('A söylem boş metin DEĞİL (tek boşluk), ses 0', synth.spoken[0].text === ' ' && synth.spoken[0].volume === 0);
ok('A başlamadan kilit hâlâ kapalı', V.voiceUnlocked() === false);

// B) süren konuşma varsa kilit denemesi onu bozmaz
synth.speaking = true; tap(); synth.speaking = false;
ok('B konuşurken kilit denemesi söylem eklemez', synth.spoken.length === 1);

// C) duraklamış motor sürdürülür
synth.paused = true; tap();
ok('C duraklamış motor resume edildi', synth.resumed === 1 && synth.spoken.length === 2);

// D) söylem başlayınca kilit açılır; dinleyici ilk sonraki dokunuşta kalkar; sonra söylem gönderilmez
synth.spoken[1].onstart();
ok('D onstart sonrası kilit açık', V.voiceUnlocked() === true);
tap();
ok('D açıkken yeni kilit söylemi yok', synth.spoken.length === 2);
ok('D dinleyici kaldırıldı', !listeners.some((l) => l.t === 'pointerdown'));
V.unlockVoice();
ok('D açıkken unlockVoice() işlemsiz', synth.spoken.length === 2);

// E) hata bildirimi: reddedilen söylemin NEDENİ dinleyiciye gider (metin gitmez); interrupted/canceled gitmez
const issues = [];
const off = V.onVoiceIssue((r) => issues.push(r));
ok('E speak() true döner (nav.voice varsayılan açık)', V.speak('Merhaba', { key: 'k1', cooldownMs: 0 }) === true);
const u = synth.spoken.at(-1);
ok('E gerçek metin konuşuldu', u.text === 'Merhaba' && typeof u.onend === 'function' && typeof u.onstart === 'function');
u.onerror({ error: 'not-allowed' });
u.onerror({ error: 'interrupted' });
u.onerror({ error: 'canceled' });
ok('E yalnız gerçek neden bildirildi', JSON.stringify(issues) === '["not-allowed"]');
off();
u.onerror({ error: 'synthesis-failed' });
ok('E abonelik kaldırılınca bildirim yok', issues.length === 1);

// F) speak(): kesme yokken duraklamış motor sürdürülür
synth.paused = true; const before = synth.resumed;
V.speak('Tekrar', { key: 'k2', cooldownMs: 0 });
ok('F speak() duraklamış motoru sürdürür', synth.resumed === before + 1);

// G) kaynak denetimi: navigator dokunuşta eşzamanlı kilit açar, ilk kez kilitliyse sesli söylem kullanır
const nav = read('js/nav/navigator.js');
const start = nav.slice(nav.indexOf('export async function startNav'));
const iUnlock = start.indexOf('unlockVoice()'), iAwait = start.indexOf('await ');
ok('G startNav ilk await\'ten ÖNCE unlockVoice() çağırır', iUnlock > 0 && iAwait > iUnlock);
ok('G kilit kapalıysa sesli kısa söylem (anahtar aç yolu ile aynı metin)', /!voiceUnlocked\(\)\s*&&\s*speak\('Sesli yönlendirme açık\.'/.test(start));
ok('G eski boş sessiz söylem kalmadı', !/SpeechSynthesisUtterance\(''\)/.test(nav));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
