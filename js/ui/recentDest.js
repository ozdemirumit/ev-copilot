// Son hedefler: planlanan rotaların varışları cihazda saklanır (en çok 8). Rota sayfasında Varış kutusunun altında kapalı açılır liste olarak görünür;
// dokununca varış olarak doldurulur (Rotayı Planla ile yeniden planlanır). Açılışta eski rota kendiliğinden yüklenmez.
// Varış kutusu boşken (odaklanınca) son hedefler öneri kutusunda (#suggest-end) da listelenir: klavye açıkken tek dokunuşla seçilir
// (pointerdown + preventDefault: odak kaybı/düzen kayması dokunuşu yutmaz). Açılır listenin başlığı da klavye açıkken ilk dokunuşta açılır.
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
  const boxes = [document.getElementById('recent-dest'), document.getElementById('recent-dest-tab')].filter(Boolean);
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || '', textContent: text ?? '' });

  function fill(box, list, showEmpty) {
    if (!showEmpty) box.classList.toggle('hidden', !list.length); // Rota sayfasında liste boşken hiç görünmez
    const wasOpen = !!box.querySelector('details')?.open; // yeniden çizimde (ör. bir hedef silinince) açık liste kapanmasın
    if (!list.length) {
      box.replaceChildren(...(showEmpty ? [el('div', 'empty small muted', 'Henüz son hedef yok')] : []));
      return;
    }
    const head = el('div', 'row between');
    head.append(el('span', 'small muted', '')); // başlık: Favoriler sekmesinde kartın kendisi, Rota sayfasında açılır listenin satırı
    const clear = el('button', 'btn ghost sm', '🧹 Listeyi temizle');
    clear.type = 'button';
    clear.addEventListener('click', () => { save(KEY, []); render(); });
    head.append(clear);
    const chips = el('div', 'recent-chips');
    if (!showEmpty) Object.assign(chips.style, { maxHeight: '30dvh', overflowY: 'auto' }); // Rota sayfasında açık liste formu aşağı itmez, kendi içinde kayar
    list.forEach((d, i) => {
      const wrap = el('span', 'recent-chip');
      const b = el('button', 'chip', `🕘 ${d.label}`);
      b.type = 'button';
      b.title = tr('Varış yap');
      b.addEventListener('click', () => {
        mapApi.setPoint('end', { lat: d.lat, lon: d.lon, label: d.label }, { zoom: true });
        const fold = b.closest('details'); // seçim yapıldı: Rota sayfasında liste yer kaplamasın
        if (fold) fold.open = false;
      });
      const x = el('button', 'chip-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', tr('Listeden sil'));
      x.addEventListener('click', () => { const cur = read(); cur.splice(i, 1); save(KEY, cur); render(); });
      wrap.append(b, x);
      chips.append(wrap);
    });
    if (showEmpty) { box.replaceChildren(chips, head); return; }
    const fold = el('details', 'recent-fold');
    fold.open = wasOpen;
    const sum = el('summary');
    sum.append(el('span', '', 'Son hedefler'), el('span', 'recent-count', String(list.length)));
    // Klavye açıkken (metin kutusu odakta) ilk dokunuş odak kaybıyla kayan düzende kaybolmasın: açma pointerdown'da yapılır, ardından gelen click yutulur.
    let tapped = false;
    sum.addEventListener('pointerdown', (e) => {
      const a = document.activeElement;
      if (!a || !/^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
      e.preventDefault();
      fold.open = !fold.open;
      tapped = true;
      setTimeout(() => { tapped = false; }, 700);
      a.blur();
    });
    sum.addEventListener('click', (e) => { if (tapped) { tapped = false; e.preventDefault(); } });
    fold.append(sum, chips, head);
    box.replaceChildren(fold);
  }

  function render() {
    const list = read();
    boxes.forEach((box) => fill(box, list, box.id === 'recent-dest-tab'));
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
