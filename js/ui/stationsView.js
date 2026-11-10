import { tr, t } from '../i18n/index.js';
import { progressKm } from '../routing/progress.js';
import { getState, patch, subscribe } from '../state.js';
import { load, save } from '../utils/storage.js';
import { getOperators, persistOperators, resetOperators, removeDiscovered, onOperatorsChange } from '../routing/operators.js';
import { repriceAndReplan, refetchStations } from '../routing/controller.js';
import { setStationOperator } from '../routing/chargerSource.js';
import { slotEl } from '../routing/slots.js';
import { PLANNER } from '../config.js';
import { brandOk } from '../routing/planner.js';
import { loosenPower, paintPowerNote, initPowerFilter } from '../routing/powerFilter.js';
import { paintMore } from './moreToggle.js';

const $ = (id) => document.getElementById(id);
const ROUTE_LIMIT = 3; // Rotadakiler: kapalıyken en çok 3 satır, "+" ile tümü
let routeOpen = false;
const MODE_TITLE = { fast: 'Hızlı', cheap: 'Ekonomik', opt: 'Optimum (süre + maliyet)' };

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
  $('station-title').textContent = `${tr('Rotadakiler')} · ${tr(MODE_TITLE[p.mode])}`;
  // Rota yoksa "Rotadakiler" kartı hiç görünmez (hata varsa nedeni göstermek için görünür kalır)
  $('route-stations-card').classList.toggle('hidden', !p.profile && !(p.stationInfo?.errors || []).length);
  paintMore($('station-more'), 0, ROUTE_LIMIT, false);
  paintPowerNote($('route-power-note'), null);

  // Veri kaynağı sorunları kalıcı gösterilir (toast kaybolur): hata varsa neden + "yeniden ara".
  const warn = $('station-warn');
  const retry = $('station-retry');
  const errs = p.stationInfo?.errors || [];
  const none = !!p.profile && p.status !== 'loading' && !p.stations.length;
  warn.textContent = errs.length
    ? (none ? 'Hiç istasyon alınamadı. ' : 'Liste eksik olabilir. ') + errs.join(' · ')
      + ' — İnternet bağlantını kontrol et; sorun geçiciyse biraz sonra yeniden dene (açık kaynak sunucular zaman zaman yanıt vermez).'
    : none ? `Rota boyunca uygun (DC, ≥40 kW) istasyon bulunamadı (OpenStreetMap/OpenChargeMap verisi). Bildiğin istasyonları "Kendi istasyonlarım"dan ekleyebilirsin.` : '';
  warn.classList.toggle('hidden', !warn.textContent);
  retry.classList.toggle('hidden', !(errs.length || none));
  retry.disabled = p.status === 'loading';

  if (!p.profile || !p.ranking) {
    hint.textContent = 'Rota planlayınca rotadaki istasyonlar burada listelenir.';
    return;
  }
  const here = progressKm();
  const ahead = (st) => st.km > here - 0.3; // geride kalan istasyonlar listeden çıkar
  const stops = p.stops.filter((s) => ahead(s.station));
  const planned = new Map(stops.map((s, i) => [s.station.id, i + 1]));
  const cand = p.ranking.filter((r) => ahead(r.station) && !planned.has(r.station.id));
  const pw = loosenPower((v) => cand.filter((r) => r.station.kw >= v).length); // uygun aday yoksa süzgeç gevşer
  paintPowerNote($('route-power-note'), pw);
  const rows = cand.filter((r) => r.station.kw >= pw.min).slice(0, 25); // plandakiler süzgeçten etkilenmez
  const planRows = stops.map((s) => ({ station: s.station, arrive: s.arriveSoc, to: s.leaveSoc, minutes: s.minutes + s.overheadMin, cost: s.cost }));

  const aheadCount = p.stations.filter(ahead).length;
  const sm = p.stationInfo?.summary;
  const smText = sm
    ? ' ' + t('Kaynak: {0} kayıt → {1} aday', sm.raw, sm.kept) + (Object.keys(sm.drop).length ? ` (${Object.entries(sm.drop).map(([k, v]) => `${tr(k)} ${v}`).join(', ')})` : '')
      + ' ' + t('· 100 km başına aday: {0}.', sm.bins.map((n, i) => `${i * 100}–${i * 100 + 100}: ${n}`).join(' · '))
    : '';
  hint.textContent = t('{0} istasyon ileride, {1} tanesine ek şarj olmadan ulaşılabiliyor.', aheadCount, rows.length + planRows.length) + ' '
    + t('Aday satırlarında süre/maliyet: varış pilinden %80\'e (veya +10 puana) şarj.') + smText;

  const allRows = [...planRows, ...rows];
  paintMore($('station-more'), allRows.length, ROUTE_LIMIT, routeOpen);
  (routeOpen ? allRows : allRows.slice(0, ROUTE_LIMIT)).forEach((r) => {
    const n = planned.get(r.station.id);
    const div = document.createElement('div');
    div.className = 'station';
    const left = document.createElement('div');
    left.append(text('div', 'name', r.station.name));
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.append(
      text('span', 'tag ' + (n ? 'best' : ''), (n ? `Planda #${n}` : 'Aday') + (brandOk(r.station) ? '' : ' · ' + tr('tercih dışı'))),
      text('span', '', r.station.foreign
        ? `${r.station.opName} · ${r.station.slow ? 'AC/yavaş ' : ''}${r.station.kw} kW${r.station.uncertain ? '*' : ''} · ${Math.max(0, r.station.km - here).toFixed(0)} km ileride · varış %${r.arrive.toFixed(0)}${r.noCharge ? ' · ' + tr('şarj gerekmez') : ` → %${Math.round(r.to)}`}`
        : `${r.station.opName} · ${r.station.slow ? 'AC/yavaş ' : ''}${r.station.kw} kW${r.station.uncertain ? '*' : ''} · ${r.station.price.toFixed(2)} TL/kWh · ${Math.max(0, r.station.km - here).toFixed(0)} km ileride · varış %${r.arrive.toFixed(0)}${r.noCharge ? ' · ' + tr('şarj gerekmez') : ` → %${Math.round(r.to)}`}`),
    );
    const slotNode = slotEl(r.station);
    if (slotNode) meta.lastElementChild.append(slotNode);
    left.append(meta);

    // Operatör yanlışsa (kayıttaki ad yanıltıcı olabilir) düzelt: fiyat ve kW tablodan buna göre alınır, kalıcıdır.
    const fix = document.createElement('select');
    fix.className = 'op-fix';
    fix.setAttribute('aria-label', 'Operatörü düzelt');
    getOperators().forEach((o) => fix.append(new Option(o.name + (o.id === r.station.opRaw && r.station.corrected ? ` (kayıt)` : ''), o.id)));
    fix.value = r.station.opId;
    fix.addEventListener('change', () => {
      setStationOperator(r.station.id, fix.value === r.station.opRaw ? null : fix.value);
      repriceAndReplan();
    });
    left.append(fix);
    const nums = document.createElement('div');
    nums.className = 'nums';
    const b = text('b', '', r.noCharge ? '—' : `${Math.round(r.minutes)} dk`);
    nums.append(b);
    if (!r.station.foreign && !r.noCharge) nums.append(document.createElement('br'), text('span', '', `${r.cost.toFixed(0)} TL`));
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
    if (op.found) { // keşfedilen marka: istenmiyorsa silinebilir
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn ghost sm';
      del.textContent = '×';
      del.title = 'Bu markayı listeden çıkar';
      del.addEventListener('click', () => {
        const sel = getState('route').brands || [];
        if (sel.includes(op.id)) { // silinen marka seçiliyse seçimden de çık, yoksa hiç istasyon kalmaz
          const list = sel.filter((x) => x !== op.id);
          PLANNER.brands = list;
          save('brandPref', list);
          patch('route', { brands: list });
        }
        removeDiscovered(op.id);
        repriceAndReplan();
      });
      tr.children[0].append(' ', del);
    }
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

/** Tercih edilen şarj markaları: çoklu seçim, hiçbiri seçili değilse hepsi. Plan ve liste hemen yeniden hesaplanır (ağ çağrısı yok). */
function initBrands() {
  const box = $('brand-chips');
  const paint = () => {
    const sel = getState('route').brands || [];
    box.replaceChildren();
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'btn sm' + (sel.length ? '' : ' sel');
    all.textContent = tr('Tümü');
    all.setAttribute('aria-pressed', String(!sel.length));
    all.addEventListener('click', () => setBrands([]));
    box.append(all);
    const ops = getOperators().filter((o) => o.id !== 'other');
    [...ops.filter((o) => sel.includes(o.id)), ...ops.filter((o) => !sel.includes(o.id))].forEach((o) => { // seçili markalar önce: kapalı satırlarda gizli kalmasın
      const b = document.createElement('button');
      const on = sel.includes(o.id);
      b.type = 'button';
      b.className = 'btn sm' + (on ? ' sel' : '');
      b.textContent = o.name;
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => setBrands(on ? sel.filter((x) => x !== o.id) : [...sel, o.id]));
      box.append(b);
    });
    fit();
  };
  // Kapalıyken en çok 3 satır: sığmayan çipler gizlenir, "+" ile tümü açılır. Ölçüm sekme açıkken yapılır (kapalı sekmede boyut yok).
  let brandsOpen = false;
  const moreBtn = $('brand-more');
  function fit() {
    box.style.maxHeight = '';
    box.classList.remove('clamped');
    const kids = [...box.children];
    if (!kids.length || !box.offsetParent) return;
    const top0 = kids[0].offsetTop;
    const h = kids[0].offsetHeight;
    const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
    const hidden = kids.filter((k) => k.offsetTop - top0 >= 3 * (h + gap) - 1).length;
    paintMore(moreBtn, hidden, 0, brandsOpen);
    if (hidden && !brandsOpen) { box.style.maxHeight = `${3 * h + 2 * gap}px`; box.classList.add('clamped'); }
  }
  moreBtn.addEventListener('click', () => { brandsOpen = !brandsOpen; fit(); });
  document.addEventListener('tabchange', (e) => { if (e.detail === 'stations') fit(); });
  window.addEventListener('resize', () => fit());
  const setBrands = (list) => {
    PLANNER.brands = list;
    save('brandPref', list);
    patch('route', { brands: list }); // controller imzayı görür ve ağ çağrısı olmadan yeniden planlar
  };
  subscribe('route', paint);
  paint();
  // Yeni marka keşfedilince (ya da silinince) çipler ve fiyat tablosu yenilenir; fiyat girilirken tablo elden bırakılmaz
  let timer;
  onOperatorsChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      paint();
      if (!document.activeElement?.closest?.('#op-body')) renderOperators();
    }, 600);
  });
}

export function initStationsView() {
  initBrands();
  initPowerFilter();
  document.addEventListener('powerfilter', renderList);
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
  $('station-more').addEventListener('click', () => { routeOpen = !routeOpen; renderList(); });
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
