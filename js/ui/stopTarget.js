// v0.99.98 — Durak başına şarj hedefi penceresi. Kaydırıcı/±5 yalnızca ÖNİZLER (previewStopTarget: ağ yok, plan değişmez);
// plan yalnızca "Onayla" ile değişir (applyStopTarget). İptal / kapatma / Esc → mevcut plan aynen kalır.
import { getState } from '../state.js';
import { previewStopTarget, applyStopTarget } from '../routing/controller.js';
import { targetBounds, clampTarget, stopCharge } from '../routing/stopTarget.js';
import { t, tr } from '../i18n/index.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const hm = (min) => {
  const m = Math.round(Math.abs(min));
  return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`;
};
const sign = (v, s = '') => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}${s}`;

let cur = null; // { stop, bounds, preview, timer }
let bound = false;

function bind() {
  if (bound) return;
  bound = true;
  const dlg = $('target-dialog');
  const close = () => { cur = null; dlg.close(); };
  $('st-x').addEventListener('click', close);
  $('st-cancel').addEventListener('click', close); // İptal: plan değişmez
  dlg.addEventListener('close', () => { if (cur) clearTimeout(cur.timer); cur = null; });
  $('st-range').addEventListener('input', () => setTarget($('st-range').value));
  $('st-minus').addEventListener('click', () => setTarget(Number($('st-range').value) - 5));
  $('st-plus').addEventListener('click', () => setTarget(Number($('st-range').value) + 5));
  $('st-auto').addEventListener('click', () => { if (cur) { cur.auto = true; schedule(); } });
  $('st-apply').addEventListener('click', () => {
    if (!cur?.preview) return;
    const r = applyStopTarget(cur.preview);
    if (!r.ok) { toast(tr(r.reason), 7000); return; }
    toast(cur.auto ? t('Şarj hedefi otomatiğe döndü: {0}', cur.stop.station.name) : t('Şarj hedefi %{0}: {1}. Sonraki duraklar yeniden hesaplandı.', cur.preview.target, cur.stop.station.name), 6000);
    close();
  });
}

function setTarget(v) {
  if (!cur) return;
  cur.auto = false;
  const x = clampTarget(v, cur.bounds);
  $('st-range').value = String(x);
  paintLocal(x);
  schedule();
}

/** Durağın kendisi (anında): hedef, eklenen kWh/puan, eğriden süre, maliyet yalnız doğrulanmış tarifede. */
function paintLocal(x) {
  const { stop, bounds } = cur;
  const c = stopCharge(stop, x, { userMax: bounds.userMax });
  $('st-val').textContent = `%${x}`;
  const rows = [
    [tr('Durağa varışta pil'), `%${stop.arriveSoc.toFixed(0)}`],
    [tr('Eklenecek'), c.addPct > 0 ? `+${c.addPct.toFixed(0)} ${tr('puan')} · ${c.kwh.toFixed(1)} kWh` : tr('şarj yok')],
    [tr('Tahmini şarj'), c.addPct > 0 ? `~${hm(c.minutes)} (${stop.station.kw} kW)` : '—'],
    [tr('Maliyet'), c.cost != null ? `${c.cost.toFixed(0)} TL` : tr('Doğrulanmış tarife yok')],
  ];
  $('st-stats').replaceChildren(...rows.map(([k, v]) => { const d = el('div', 'st-stat'); d.append(el('span', 'k', k), el('b', 'v', v)); return d; }));
  const warn = [];
  if (c.overUserMax) warn.push(t('Ayarlardaki durak üst sınırın %{0}; üstü yavaş şarj olur.', bounds.userMax));
  if (x >= 95) warn.push(tr('%95 üstünde şarj çok yavaşlar; süre yaklaşıktır.'));
  if (stop.station.slow) warn.push(tr('AC/yavaş istasyon: süre aracın AC sınırına göre daha uzun olabilir.'));
  warn.push(tr('Süre uygulamanın yaklaşık şarj eğrisinden (üretici verisi değil).'));
  $('st-warn').replaceChildren(...warn.map((w) => el('div', null, w)));
}

function schedule() {
  clearTimeout(cur.timer);
  $('st-apply').disabled = true;
  $('st-diff').replaceChildren(el('div', 'muted', tr('Plan yeniden hesaplanıyor…')));
  cur.timer = setTimeout(runPreview, 180);
}

/** Alt akış önizlemesi: sonraki duraklar, sıralama, varış pili, süre farkı. Plan değişmez. */
function runPreview() {
  if (!cur) return;
  const target = cur.auto ? null : Number($('st-range').value);
  const r = previewStopTarget(cur.stop.station.id, target);
  const box = $('st-diff');
  cur.preview = null;
  if (!r.ok) {
    box.replaceChildren(el('div', 'st-bad', tr(r.reason || 'Plan kurulamadı')), el('div', 'muted', tr('Bu hedefle plan uygulanamaz; mevcut plan değişmedi.')));
    $('st-apply').disabled = true;
    return;
  }
  cur.preview = r.preview;
  renderPlanDiff(box, r.preview, { meId: cur.stop.station.id });
  $('st-apply').disabled = r.preview.diff.same;
}

/** Önizleme farkını kutuya çiz: çıkan/eklenen duraklar, sıra, ileri duraklar (varış → ayrılış, şarj dk), toplam süre, varışta pil, ETA, maliyet. */
export function renderPlanDiff(box, preview, { meId = null } = {}) {
  const { diff, out } = preview;
  const lines = [];
  if (diff.same) lines.push(el('div', 'muted', tr('Plan değişmiyor.')));
  for (const n of diff.removed) lines.push(el('div', 'st-rm', t('Çıkar: {0}', n)));
  for (const n of diff.added) lines.push(el('div', 'st-add', t('Ekle: {0}', n)));
  if (diff.orderChanged) lines.push(el('div', null, tr('Durak sırası değişti.')));
  const list = el('ol', 'st-list');
  out.result.stops.filter((s) => s.km > (out.fromKm ?? getState('plan').fromKm ?? 0) + 0.5).forEach((s) => {
    const li = el('li', s.station.id === meId ? 'me' : null);
    li.append(el('b', null, s.station.name), el('span', 'm', `${s.km.toFixed(0)} km · %${s.arriveSoc.toFixed(0)} → %${Math.round(s.leaveSoc)} · ${Math.round(s.minutes)} dk`));
    list.append(li);
  });
  const tot = out.result.totals;
  const sum = el('div', 'st-sum');
  sum.append(
    el('span', null, t('Toplam süre {0} ({1} dk)', hm(tot.totalMin), sign(diff.totalMinDelta))),
    el('span', null, t('Varışta pil %{0} ({1} puan)', tot.arriveSoc.toFixed(0), sign(diff.arriveSocDelta))),
  );
  const eta = new Date(Date.now() + tot.totalMin * 60000);
  sum.append(el('span', null, t('Tahmini varış {0}', eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))));
  if (diff.costDelta != null) sum.append(el('span', null, t('Maliyet farkı {0} TL', sign(diff.costDelta))));
  box.replaceChildren(...lines, list, sum);
}

/** stop: plan.stops öğesi. Durağın hedef penceresini açar; mevcut hedef/kilit yüklenir. */
export function openTarget(stop) {
  bind();
  const p = getState('plan');
  const bounds = targetBounds(stop, { userMax: getState('route').maxChargeTo });
  const locked = Number.isFinite(p.leaveSocs?.[stop.station.id]);
  cur = { stop, bounds, preview: null, timer: null, auto: false };
  $('st-sub').textContent = `${stop.station.name} · ${stop.station.opName || ''} ${stop.station.kw} kW`;
  const r = $('st-range');
  r.min = String(bounds.lo); r.max = String(bounds.hi); r.step = '1';
  r.value = String(clampTarget(stop.leaveSoc, bounds));
  r.style.setProperty('--um', `${((bounds.userMax - bounds.lo) / Math.max(1, bounds.hi - bounds.lo)) * 100}%`);
  $('st-lo').textContent = `%${bounds.lo}`;
  $('st-hi').textContent = `%${bounds.hi}`;
  $('st-auto').classList.toggle('hidden', !locked);
  paintLocal(Number(r.value));
  $('st-diff').replaceChildren(el('div', 'muted', tr('Hedefi değiştir: sonraki duraklar ve varış önizlenir. Plan yalnızca Onayla ile değişir.')));
  $('st-apply').disabled = true;
  $('target-dialog').showModal();
}
