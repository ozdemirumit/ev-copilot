// Son hedefler: Varış kutusu boşken öneri kutusunda tek dokunuşla seçilebilen en çok 8 kayıt (recentSuggestions, saf).
import { recentSuggestions, RECENT_SUGGEST_MAX } from '../js/ui/recentDest.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

const mk = (n) => Array.from({ length: n }, (_, i) => ({ label: 'Yer ' + i, lat: 39 + i / 100, lon: 32, at: i }));

ok(RECENT_SUGGEST_MAX === 8, 'üst sınır 8');
ok(recentSuggestions(mk(3), '').length === 3, 'boş alanda tüm kayıtlar (3)');
ok(recentSuggestions(mk(12), '').length === 8, 'boş alanda en çok 8 satır');
ok(recentSuggestions(mk(12), '   ').length === 8, 'yalnızca boşluk = boş alan');
ok(recentSuggestions(mk(12), '').map((d) => d.label).join() === mk(8).map((d) => d.label).join(), 'sıra korunur (en yeni başta)');
ok(recentSuggestions(mk(5), 'An').length === 0, 'yazı varken son hedef satırı yok (yer araması devralır)');
ok(recentSuggestions(mk(5), 'Ankara').length === 0, 'uzun yazıda da yok');
ok(recentSuggestions([], '').length === 0, 'liste boşken satır yok (kutu gizli kalır)');
ok(recentSuggestions(null, '').length === 0, 'kayıt okunamadıysa boş');
ok(recentSuggestions(mk(2), null).length === 2, 'değer null = boş alan');
const bad = [{ label: 'x', lat: null, lon: 32 }, { label: 'y', lat: 39, lon: 32 }, { label: '<b>z</b>', lat: 40, lon: 33 }];
const r = recentSuggestions(bad, '');
ok(r.length === 2 && r[0].label === 'y', 'koordinatı eksik kayıt atlanır');
ok(r[1].label === '<b>z</b>', 'etiket olduğu gibi döner (DOM\'a textContent ile yazılır)');
const src = (await import('node:fs')).readFileSync(new URL('../js/ui/recentDest.js', import.meta.url), 'utf8');
ok(/pointerdown/.test(src) && /preventDefault/.test(src), 'satır seçimi pointerdown + preventDefault (odak kaybından önce)');
ok(!/innerHTML/.test(src), 'innerHTML kullanılmaz');

console.log(`test-recent-dest: ${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
