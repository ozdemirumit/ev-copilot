import { getState } from '../state.js';
import { getOperators } from '../routing/operators.js';
import { addCustomStation, removeCustomStation, getCustomStations } from '../routing/chargerSource.js';
import { refetchStations } from '../routing/controller.js';
import { attachSearch } from './placeSearch.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);

/** "Kendi istasyonlarım": haritada eksik istasyonu elle ekle (yer arama veya bulunduğum yer), listele, sil. */
export function initCustomStations() {
  const op = $('cs-op');
  getOperators().forEach((o) => op.append(new Option(o.name, o.id)));
  let picked = null; // { label, lat, lon }

  attachSearch($('cs-search'), $('cs-suggest'), (r) => {
    picked = r;
    $('cs-search').value = r.label;
    $('cs-picked').textContent = `Seçilen konum: ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`;
  });

  function paintList() {
    const list = $('cs-list');
    list.replaceChildren();
    getCustomStations().forEach((c) => {
      const row = document.createElement('div');
      row.className = 'stop';
      const del = Object.assign(document.createElement('button'), { className: 'btn ghost', type: 'button', textContent: '✕', ariaLabel: 'Sil' });
      del.addEventListener('click', () => { removeCustomStation(c.id); paintList(); replan(); });
      row.append(
        Object.assign(document.createElement('div'), { className: 'num', textContent: '★' }),
        Object.assign(document.createElement('div'), { className: 't', textContent: c.name }),
        del,
        Object.assign(document.createElement('div'), {
          className: 'm',
          textContent: `${getOperators().find((o) => o.id === c.opId)?.name || c.opId}${c.kw ? ` · ${c.kw} kW` : ''} · ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`,
        }),
      );
      list.append(row);
    });
  }

  // Planlanmış bir rota varsa yeni istasyonlarla yeniden planla (önbellekteki canlı veri tekrar kullanılır)
  const replan = () => { if (getState('plan').profile) refetchStations(); };

  function add(point, name) {
    const kw = Number($('cs-kw').value) || null;
    addCustomStation({ name: name || point.label, lat: point.lat, lon: point.lon, opId: op.value, kw });
    $('cs-search').value = '';
    $('cs-picked').textContent = '';
    picked = null;
    paintList();
    replan();
    toast('İstasyon eklendi');
  }

  $('cs-add').addEventListener('click', () => (picked ? add(picked) : toast('Önce bir yer ara ve listeden seç')));
  $('cs-here').addEventListener('click', () => {
    const { lat, lon } = getState('live');
    if (lat == null) return toast('Konum yok: önce GPS açık olmalı');
    add({ lat, lon, label: 'Bulunduğum yer' }, `${op.selectedOptions[0].text} (benim)`);
  });
  paintList();
}
