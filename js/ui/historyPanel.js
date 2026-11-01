// Menzil sekmesi: yolculuk özeti, tüketim/hız grafiği, hız bandı tablosu ve planda kullanılan k.
import { locale } from '../i18n/index.js';
import { getState, subscribe } from '../state.js';
import { records, byBand, summary, clearHistory, relFactor } from '../physics/history.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { bar: '#2ee6a6', line: '#5aa9ff', grid: '#243244', text: '#8a9bb0' };
const CHART_N = 40;

function svg(tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (text != null) el.textContent = text;
  return el;
}

/** Son CHART_N ölçüm: çubuk = kWh/100km, çizgi = ortalama hız. Her ikisi kendi ölçeğinde (üst değerler legendde yazar). */
function drawChart(rs) {
  const box = $('h-chart');
  box.replaceChildren();
  if (rs.length < 2) {
    box.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Henüz yeterli ölçüm yok (sürerken pil yüzdesi düştükçe birikir).' }));
    $('h-legend').textContent = '';
    return;
  }
  const W = 320;
  const H = 120;
  const pad = 14;
  const maxC = Math.max(30, ...rs.map((r) => r.kwh100));
  const maxV = Math.max(130, ...rs.map((r) => r.v));
  const bw = (W - 2 * pad) / rs.length;
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
  for (let i = 0; i <= 3; i++) g.append(svg('line', { x1: pad, x2: W - pad, y1: pad + ((H - 2 * pad) * i) / 3, y2: pad + ((H - 2 * pad) * i) / 3, stroke: COLORS.grid, 'stroke-width': 1 }));
  rs.forEach((r, i) => {
    const h = ((H - 2 * pad) * r.kwh100) / maxC;
    g.append(svg('rect', { x: pad + i * bw + 1, y: H - pad - h, width: Math.max(1, bw - 2), height: h, fill: COLORS.bar, opacity: 0.75 }));
  });
  const pts = rs.map((r, i) => `${(pad + i * bw + bw / 2).toFixed(1)},${(H - pad - ((H - 2 * pad) * r.v) / maxV).toFixed(1)}`).join(' ');
  g.append(svg('polyline', { points: pts, fill: 'none', stroke: COLORS.line, 'stroke-width': 2 }));
  box.append(g);
  $('h-legend').textContent = `Çubuk: kWh/100km (üst sınır ${maxC.toFixed(0)}) · Çizgi: hız km/s (üst sınır ${maxV.toFixed(0)}) · son ${rs.length} ölçüm (sol eski, sağ yeni)`;
}

/** Kayıtları yolculuğa (trip) göre topla: mesafe, sürüş süresi, ortalama hız, enerji (kWh), pil düşüşü. En yeni üstte. */
function tripsOf(rs) {
  const by = new Map();
  for (const r of rs) {
    const a = by.get(r.trip) || { dist: 0, hours: 0, kwh: 0, drop: 0, t0: Infinity, t1: 0, n: 0 };
    a.dist += r.dist;
    a.hours += r.dist / r.v;
    a.kwh += (r.kwh100 * r.dist) / 100;
    a.drop += r.drop;
    a.t0 = Math.min(a.t0, r.t - (r.dist / r.v) * 3600e3);
    a.t1 = Math.max(a.t1, r.t);
    a.n++;
    by.set(r.trip, a);
  }
  return [...by.values()].sort((x, y) => y.t1 - x.t1);
}

const hmDur = (h) => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`; };

function paintTrips(rs) {
  const box = $('h-trips');
  if (!box) return;
  box.replaceChildren();
  const trips = tripsOf(rs).slice(0, 15);
  if (!trips.length) {
    box.append(Object.assign(document.createElement('div'), { className: 'empty small muted', textContent: 'Henüz yolculuk kaydı yok (sürerken pil yüzdesi düştükçe birikir).' }));
    return;
  }
  trips.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'trip';
    const when = new Date(t.t0).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    row.append(
      Object.assign(document.createElement('b'), { textContent: when }),
      Object.assign(document.createElement('span'), { textContent: `${t.dist.toFixed(0)} km · ${hmDur(t.hours)} · ort. ${(t.dist / t.hours).toFixed(0)} km/s` }),
      Object.assign(document.createElement('span'), { className: 'muted', textContent: `${t.kwh.toFixed(1)} kWh · ${((t.kwh / t.dist) * 100).toFixed(1)} kWh/100km · pil −%${t.drop} (${t.n} ölçüm)` }),
    );
    box.append(row);
  });
}

const fmt = (s) => (s ? `${s.km.toFixed(0)} km · ${s.kwh100.toFixed(1)} kWh/100km · ort. ${s.v.toFixed(0)} km/s` : 'veri yok');

function paint() {
  const rs = records();
  const s = summary();
  $('h-trip').textContent = fmt(s.trip);
  $('h-all').textContent = fmt(s.all) + (s.all ? ` (${s.all.n} ölçüm)` : '');
  const ki = getState('plan').kInfo;
  $('h-k').textContent = ki ? `${ki.k.toFixed(2)} — ${ki.src}` : '—';
  const rel = $('h-rel');
  if (rel) {
    const refV = ki?.refV ?? null;
    const parts = [50, 70, 90, 110, 130].map((v) => ({ v, f: relFactor(v, refV) }));
    rel.textContent = parts.some((p) => Math.abs(p.f - 1) > 0.005)
      ? `Hız düzeltmesi (${refV == null ? 'geçmiş ortalamaya' : Math.round(refV) + ' km/s\'e'} göre): ` + parts.map((p) => `${p.v} km/s ×${p.f.toFixed(2)}`).join(' · ')
      : 'Hız düzeltmesi: yeterli ölçüm birikince (her hızda ≥ 25 km) burada görünür.';
  }
  paintTrips(rs);
  drawChart(rs.slice(-CHART_N));

  const body = $('h-bands');
  body.replaceChildren();
  byBand().forEach((b) => {
    const tr = document.createElement('tr');
    [b.label, b.km ? b.km.toFixed(0) : '—', b.kwh100 != null ? b.kwh100.toFixed(1) : '—', b.kBase != null ? b.kBase.toFixed(2) : '—']
      .forEach((t) => tr.append(Object.assign(document.createElement('td'), { textContent: t })));
    body.append(tr);
  });
}

export function initHistoryPanel() {
  $('h-clear').addEventListener('click', () => {
    const btn = $('h-clear');
    if (btn.dataset.armed) { clearHistory(); delete btn.dataset.armed; btn.textContent = '🗑️ Geçmişi sil'; return; }
    btn.dataset.armed = '1'; // yanlışlıkla silinmesin: iki dokunuş
    btn.textContent = 'Silmek için tekrar dokun';
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = '🗑️ Geçmişi sil'; }, 4000);
  });
  subscribe(['hist', 'plan'], paint);
  paint();
}
