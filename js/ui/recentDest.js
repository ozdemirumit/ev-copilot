// Son hedefler: planlanan rotaların varışları cihazda saklanır (en çok 8). Rota sayfasında ayrı bir bölüm olarak gösterilmez;
// Varış kutusu boşken (odaklanınca) açılır öneri kutusunda (#suggest-end) listelenir: klavye açıkken tek dokunuşla seçilir
// (pointerdown + preventDefault: odak kaybı/düzen kayması dokunuşu yutmaz). Favoriler sekmesinde (#recent-dest-tab) tam liste/silme.
// Seçilen hedef varış olarak doldurulur (Rotayı Planla ile yeniden planlanır). Açılışta eski rota kendiliğinden yüklenmez.
import { load, save } from '../utils/storage.js';
import { haversineKm } from '../utils/geo.js';
import { mapApi } from './mapView.js';
import { tr } from '../i18n/index.js';

const KEY = 'recentDest';
const MAX = 8;
const read = () => load(KEY, []);
export const RECENT_SUGGEST_MAX = 8;

/** Varış kutusu boşken öneri kutusunda gösterilecek son hedefler (saf). Yazı varsa yer araması devralır: boş liste. */
export function recentSuggestions(list, value) {
  if (String(value ?? '').trim() !== '' || !Array.isArray(list)) return [];
  return list.filter((d) => d && d.lat != null && d.lon != null).slice(0, RECENT_SUGGEST_MAX);
}

/** Planlanan rotanın varışını listenin başına yaz (aynı yer ya da 300 m içindeki eski kayıt silinir). */
export function rememberDest(p) {
  if (!p || p.lat == null || p.lon == null) return;
  const label = String(p.label || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`).slice(0, 80);
  const list = read().filter((x) => haversineKm(x, p) > 0.3 && x.label !== label);
  list.unshift({ label, lat: p.lat, lon: p.lon, at: Date.now() });
  save(KEY, list.slice(0, MAX));
  document.dispatchEvent(new Event('recent-dest'));
}

export function initRecentDest() {
  const box = document.getElementById('recent-dest-tab'); // Favoriler sekmesi; Rota sayfasında ayrı liste yok (Varış açılır listesi yeterli)
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || '', textContent: text ?? '' });

  function render() {
    if (!box) return;
    const list = read();
    if (!list.length) { box.replaceChildren(el('div', 'empty small muted', 'Henüz son hedef yok')); return; }
    const head = el('div', 'row between');
    head.append(el('span', 'small muted', ''));
    const clear = el('button', 'btn ghost sm', '🧹 Listeyi temizle');
    clear.type = 'button';
    clear.addEventListener('click', () => { save(KEY, []); render(); });
    head.append(clear);
    const chips = el('div', 'recent-chips');
    list.forEach((d, i) => {
      const wrap = el('span', 'recent-chip');
      const b = el('button', 'chip', `🕘 ${d.label}`);
      b.type = 'button';
      b.title = tr('Varış yap');
      b.addEventListener('click', () => mapApi.setPoint('end', { lat: d.lat, lon: d.lon, label: d.label }, { zoom: true }));
      const x = el('button', 'chip-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', tr('Listeden sil'));
      x.addEventListener('click', () => { const cur = read(); cur.splice(i, 1); save(KEY, cur); render(); });
      wrap.append(b, x);
      chips.append(wrap);
    });
    box.replaceChildren(chips, head);
  }
  document.addEventListener('recent-dest', render);
  render();

  // Varış kutusu boşken son hedefler öneri kutusunda (yer araması yazınca kendi sonuçlarını aynı kutuya yazar)
  const input = document.getElementById('route-end');
  const sug = document.getElementById('suggest-end');
  if (!input || !sug) return;
  let mine = false; // kutu şu an son hedefleri mi gösteriyor
  const showRecent = () => {
    if (document.activeElement !== input) return;
    const rows = recentSuggestions(read(), input.value);
    if (!rows.length) { if (mine) { sug.classList.add('hidden'); sug.replaceChildren(); mine = false; } return; }
    const head = el('li', 'info', tr('Son hedefler'));
    const items = rows.map((d) => {
      const li = el('li', '');
      li.setAttribute('role', 'option');
      li.append(el('b', '', `🕘 ${d.label}`));
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // odak ve düzen kaymadan seçilir
        sug.classList.add('hidden'); sug.replaceChildren(); mine = false;
        mapApi.setPoint('end', { lat: d.lat, lon: d.lon, label: d.label }, { zoom: true });
        input.dataset.prev = d.label; // odak kaybında eski metin geri yazılmasın
        input.blur();
      });
      return li;
    });
    sug.replaceChildren(head, ...items);
    sug.classList.remove('hidden');
    mine = true;
  };
  input.addEventListener('focus', () => setTimeout(showRecent, 0)); // odakta kutuyu boşaltan işleyiciden (defaultStart) sonra
  input.addEventListener('input', () => {
    if (input.value.trim() === '') setTimeout(showRecent, 400); // yer aramasının (350 ms) gizlemesinden sonra
    else if (mine) { sug.classList.add('hidden'); sug.replaceChildren(); mine = false; }
  });
  input.addEventListener('blur', () => { mine = false; });
}
