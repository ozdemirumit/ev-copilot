import { getState, patch, subscribe } from '../state.js';
import { load, save } from '../utils/storage.js';
import { getOperators, persistOperators, resetOperators } from '../routing/operators.js';
import { repriceAndReplan, refetchStations } from '../routing/controller.js';
import { setStationOperator } from '../routing/chargerSource.js';

const $ = (id) => document.getElementById(id);
const MODE_TITLE = { fast: 'En hızlı', cheap: 'En ekonomik', opt: 'Optimum (süre + maliyet)' };

function text(tag, cls, content) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = content;
  return el;
}

/** Sıralı aday istasyon listesi: plandakiler üstte etiketli, kalanlar seçili moda göre. */
function renderList() {
  const p = getState('plan');
  const list = $('station-list');
  const hint = $('station-hint');
  list.replaceChildren();
  $('station-title').textContent = `İstasyonlar · ${MODE_TITLE[p.mode]}`;

  // Veri kaynağı sorunları kalıcı gösterilir (toast kaybolur): hata varsa neden + "yeniden ara".
  const warn = $('station-warn');
  const retry = $('station-retry');
  const errs = p.stationInfo?.errors || [];
  const none = !!p.profile && p.status !== 'loading' && !p.stations.length;
  warn.textContent = errs.length
    ? (none ? 'Hiç istasyon alınamadı. ' : 'Liste eksik olabilir. ') + errs.join(' · ')
      + ' — Google anahtarını Rota sekmesinden "Kaydet ve sına" ile kontrol et; sorun geçiciyse biraz sonra yeniden dene.'
    : none ? 'Rota boyunca uygun (DC, ≥40 kW) istasyon bulunamadı (Google verisi). Bildiğin istasyonları "Kendi istasyonlarım"dan ekleyebilirsin.' : '';
  warn.classList.toggle('hidden', !warn.textContent);
  retry.classList.toggle('hidden', !(errs.length || none));
  retry.disabled = p.status === 'loading';

  if (!p.profile || !p.ranking) {
    hint.textContent = 'Rota planlayınca rotadaki istasyonlar burada listelenir.';
    return;
  }
  const here = getState('engine').routeKm ?? p.fromKm ?? 0;
  const ahead = (st) => st.km > here - 0.3; // geride kalan istasyonlar listeden çıkar
  const stops = p.stops.filter((s) => ahead(s.station));
  const planned = new Map(stops.map((s, i) => [s.station.id, i + 1]));
  const rows = p.ranking.filter((r) => ahead(r.station) && !planned.has(r.station.id)).slice(0, 25);
  const planRows = stops.map((s) => ({ station: s.station, arrive: s.arriveSoc, to: s.leaveSoc, minutes: s.minutes + s.overheadMin, cost: s.cost }));

  const aheadCount = p.stations.filter(ahead).length;
  hint.textContent = `${aheadCount} istasyon ileride, ${rows.length + planRows.length} tanesine ek şarj olmadan ulaşılabiliyor. `
    + 'Aday satırlarında süre/maliyet: varış pilinden %80\'e (veya +10 puana) şarj.';

  [...planRows, ...rows].forEach((r) => {
    const n = planned.get(r.station.id);
    const div = document.createElement('div');
    div.className = 'station';
    const left = document.createElement('div');
    left.append(text('div', 'name', r.station.name));
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.append(
      text('span', 'tag ' + (n ? 'best' : ''), n ? `Planda #${n}` : 'Aday'),
      text('span', '', `${r.station.opName} · ${r.station.slow ? 'AC/yavaş ' : ''}${r.station.kw} kW${r.station.uncertain ? '*' : ''} · ${r.station.price.toFixed(2)} TL/kWh · ${Math.max(0, r.station.km - here).toFixed(0)} km ileride · varış %${r.arrive.toFixed(0)} → %${Math.round(r.to)}`),
    );
    left.append(meta);

    // Operatör yanlışsa (Google kaydındaki ad yanıltıcı olabilir) düzelt: fiyat ve kW tablodan buna göre alınır, kalıcıdır.
    const fix = document.createElement('select');
    fix.className = 'op-fix';
    fix.setAttribute('aria-label', 'Operatörü düzelt');
    getOperators().forEach((o) => fix.append(new Option(o.name + (o.id === r.station.opRaw && r.station.corrected ? ' (Google)' : ''), o.id)));
    fix.value = r.station.opId;
    fix.addEventListener('change', () => {
      setStationOperator(r.station.id, fix.value === r.station.opRaw ? null : fix.value);
      repriceAndReplan();
    });
    left.append(fix);
    const nums = document.createElement('div');
    nums.className = 'nums';
    const b = text('b', '', `${Math.round(r.minutes)} dk`);
    nums.append(b, document.createElement('br'), text('span', '', `${r.cost.toFixed(0)} TL`));
    div.append(left, nums);
    list.append(div);
  });
  if (!list.children.length) list.append(text('p', 'small muted', 'Erişilebilir istasyon yok.'));
}

function renderOperators() {
  const body = $('op-body');
  body.replaceChildren();
  getOperators().forEach((op) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td>
      <td><input type="number" inputmode="decimal" step="0.1" min="0" aria-label="TL/kWh"></td>
      <td><input type="number" inputmode="numeric" step="10" min="1" max="400" aria-label="kW"></td>`;
    tr.children[0].textContent = op.name;
    const [price, kw] = tr.querySelectorAll('input');
    price.value = op.price;
    kw.value = op.kw;
    let timer;
    const update = () => {
      const pv = parseFloat(price.value);
      const kv = parseFloat(kw.value);
      if (Number.isFinite(pv) && pv >= 0) op.price = pv;
      if (Number.isFinite(kv) && kv > 0) op.kw = kv;
      persistOperators();
      clearTimeout(timer);
      timer = setTimeout(repriceAndReplan, 300);
    };
    price.addEventListener('input', update);
    kw.addEventListener('input', update);
    body.append(tr);
  });
}

export function initStationsView() {
  const chips = [...document.querySelectorAll('[data-sort]')];
  const paintChips = () => chips.forEach((c) => c.classList.toggle('sel', c.dataset.sort === getState('plan').mode));

  chips.forEach((c) => c.addEventListener('click', () => {
    save('planMode', c.dataset.sort);
    patch('plan', { mode: c.dataset.sort }); // controller dinlenir: yeniden planlar
  }));

  $('op-reset').addEventListener('click', () => {
    resetOperators();
    renderOperators();
    repriceAndReplan();
  });

  $('station-retry').addEventListener('click', refetchStations);
  subscribe('plan', () => { paintChips(); renderList(); });
  // Araç ilerledikçe mesafeler güncellenir (her tam km'de bir)
  let shownKm = -1;
  subscribe('engine', () => {
    const km = Math.floor(getState('engine').routeKm ?? -1);
    if (km !== shownKm) { shownKm = km; renderList(); }
  });
  paintChips();
  renderOperators();
  renderList();
}
