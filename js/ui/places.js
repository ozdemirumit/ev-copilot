// Kayıtlı yerler: Ev, İş ve 3 favori. Rota sayfasındaki çipe dokununca yer başlangıç/varış olur; "Yerleri düzenle"den
// varışı/başlangıcı/konumu bir yuvaya kaydedilir. Yerler yalnızca bu cihazda saklanır ve haritada küçük iğnelerle görünür.
import { getState, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { mapApi } from './mapView.js';
import { toast } from './toast.js';

const KEY = 'places';
const SLOTS = [
  { id: 'home', icon: '🏠', name: 'Ev', fixed: true },
  { id: 'work', icon: '💼', name: 'İş', fixed: true },
  { id: 'fav1', icon: '⭐', name: 'Favori 1' },
  { id: 'fav2', icon: '⭐', name: 'Favori 2' },
  { id: 'fav3', icon: '⭐', name: 'Favori 3' },
];

const $ = (id) => document.getElementById(id);
const read = () => load(KEY, {});
const nameOf = (slot, p) => (slot.fixed ? slot.name : p?.name || slot.name);

function el(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

export function initPlaces() {
  const chips = $('place-chips');
  const list = $('places-list');
  const details = $('places-edit');
  let lastField = 'end'; // çipe dokununca doldurulacak kutu: son odaklanılan (varsayılan varış)
  $('route-start').addEventListener('focusin', () => { lastField = 'start'; });
  $('route-end').addEventListener('focusin', () => { lastField = 'end'; });

  const update = (id, patchObj) => {
    const all = read();
    if (patchObj === null) delete all[id]; else all[id] = { ...all[id], ...patchObj }; // favoride silince ad kalır (undefined alanlar JSON'a yazılmaz)
    save(KEY, all);
    render();
  };

  function render() {
    const all = read();
    chips.replaceChildren(...SLOTS.map((slot) => {
      const p = all[slot.id];
      const b = el('button', 'chip' + (p?.lat == null ? ' empty' : ''), `${slot.icon} ${p?.lat == null ? slot.name : nameOf(slot, p)}`);
      b.type = 'button';
      b.title = p?.lat == null ? 'Kayıtlı değil: Yerleri düzenle\'den ekle' : `${lastField === 'start' ? 'Başlangıç' : 'Varış'} yap`;
      b.addEventListener('click', () => {
        const cur = read()[slot.id];
        if (cur?.lat == null) {
          details.open = true;
          details.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return toast(`${slot.name} kayıtlı değil: aşağıdan ekle`);
        }
        mapApi.setPoint(lastField, { lat: cur.lat, lon: cur.lon, label: nameOf(slot, cur) }, { zoom: true });
      });
      return b;
    }));

    list.replaceChildren(...SLOTS.map((slot) => {
      const p = all[slot.id];
      const row = el('div', 'place-row');
      const head = el('div', 'place-head');
      head.append(el('span', 'place-icon', slot.icon));
      if (slot.fixed) head.append(el('b', '', slot.name));
      else {
        const inp = el('input');
        inp.type = 'text';
        inp.value = p?.name || '';
        inp.placeholder = slot.name;
        inp.maxLength = 24;
        inp.setAttribute('aria-label', `${slot.name} adı`);
        inp.addEventListener('change', () => {
          const v = inp.value.trim();
          const all2 = read();
          all2[slot.id] = { ...all2[slot.id], name: v || undefined };
          save(KEY, all2);
          render();
        });
        head.append(inp);
      }
      head.append(el('span', 'small muted', p?.lat == null ? 'kayıtlı değil' : `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`));
      row.append(head);

      const btns = el('div', 'row wrap');
      const mk = (text, fn, cls = 'btn ghost sm') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); btns.append(b); };
      const fromRoute = (kind) => () => {
        const pt = getState('route')[kind];
        if (!pt) return toast(kind === 'end' ? 'Önce varış seç' : 'Önce başlangıç seç');
        update(slot.id, { lat: pt.lat, lon: pt.lon });
        toast(`${nameOf(slot, read()[slot.id])} kaydedildi`);
      };
      mk('Varışı kaydet', fromRoute('end'));
      mk('Başlangıcı kaydet', fromRoute('start'));
      mk('📍 Konumum', () => {
        const e = effective();
        if (e.lat == null) return toast('Konum yok: üstteki 📍 ile GPS\'i aç');
        update(slot.id, { lat: e.lat, lon: e.lon });
        toast(`${nameOf(slot, read()[slot.id])} kaydedildi`);
      });
      if (p?.lat != null) mk('🗑 Sil', () => update(slot.id, slot.fixed ? null : { lat: undefined, lon: undefined }), 'btn danger sm');
      row.append(btns);
      return row;
    }));

    // Haritada kayıtlı yerler
    mapApi.drawPlaces(SLOTS.filter((s) => all[s.id]?.lat != null).map((s) => ({ lat: all[s.id].lat, lon: all[s.id].lon, icon: s.icon, name: nameOf(s, all[s.id]) })));
  }

  render();
}
