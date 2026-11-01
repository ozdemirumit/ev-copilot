// Son hedefler: planlanan rotaların varışları cihazda saklanır (en çok 8). Rota sayfasında Varış kutusunun altında çip olarak görünür;
// dokununca varış olarak doldurulur (Rotayı Planla ile yeniden planlanır). Açılışta eski rota kendiliğinden yüklenmez.
import { load, save } from '../utils/storage.js';
import { haversineKm } from '../utils/geo.js';
import { mapApi } from './mapView.js';
import { tr } from '../i18n/index.js';

const KEY = 'recentDest';
const MAX = 8;
const read = () => load(KEY, []);

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
  const box = document.getElementById('recent-dest');
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || '', textContent: text ?? '' });

  function render() {
    const list = read();
    box.classList.toggle('hidden', !list.length);
    if (!list.length) return box.replaceChildren();
    const head = el('div', 'row between');
    head.append(el('span', 'small muted', 'Son hedefler'));
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
    box.replaceChildren(head, chips);
  }
  document.addEventListener('recent-dest', render);
  render();
}
