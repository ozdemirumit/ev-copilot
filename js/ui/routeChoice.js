// v0.99.97 — Rota dışı şarj durağı için rota değişikliği ONAYI. Mevcut rota bu pencerede seçim yapılana kadar değişmez.
// Seçenekler routing/onRoute.js buildAlternatives sonucundan gelir (sağlayıcının gerçek rotası + plan hesabı); eksik ölçü "--" gösterilir,
// uydurulmaz. Sağlayıcı seçenek veremediyse yalnızca açıklama ve "Mevcut rotada kal" düğmesi görünür.
import { t, tr } from '../i18n/index.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const num = (v, f) => (Number.isFinite(v) ? f(v) : '--');
const sign = (v) => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v));
const PROV = { tomtom: 'TomTom', mapbox: 'Mapbox', osm: 'OSM/Valhalla', google: 'Google', here: 'HERE' };

/** Seçenek satırının metinleri (DOM'suz; test edilir). */
export function choiceLines(c) {
  const s = c.summary;
  return {
    title: c.station.name || t('Şarj istasyonu'),
    line1: t('{0} km · {1} dk ek yol', num(s.addKm, sign), num(s.addMin, sign)),
    line2: t('Durakta varış %{0} → %{1} (~{2} dk şarj) · hedefte %{3}', num(s.arriveStopSoc, Math.round), num(s.leaveStopSoc, Math.round), num(s.chargeMin, Math.round), num(s.arriveEndSoc, Math.round)),
    line3: t('Rota: {0} · {1} kW · rakım hariç, yaklaşık', PROV[c.provider] || tr('bilinmiyor'), num(c.station.kw, Math.round)),
  };
}

let dlg = null;
function dialog() {
  if (dlg) return dlg;
  dlg = el('dialog', 'sheet-dlg');
  dlg.id = 'route-choice-dialog';
  dlg.setAttribute('aria-labelledby', 'route-choice-title');
  const head = el('div', 'dlg-head');
  const h = el('h2', null, t('Rota üzerinde uygun şarj yok'));
  h.id = 'route-choice-title';
  head.append(h);
  const sub = el('p', 'small muted');
  sub.id = 'route-choice-sub';
  const list = el('div', 'swap-list');
  list.id = 'route-choice-list';
  const row = el('div', 'row');
  const keep = el('button', 'btn', t('Mevcut rotada kal'));
  keep.type = 'button';
  keep.id = 'route-choice-keep';
  row.append(keep);
  dlg.append(head, sub, list, row);
  document.body.append(dlg);
  return dlg;
}

/**
 * Kullanıcıya sor. result: buildAlternatives çıktısı. Dönüş (söz): seçilen choice ya da null (Mevcut rotada kal / pencere kapandı).
 * DOM yoksa (test, sunucu) hiçbir şey seçilmez: null.
 */
export function askRouteChoice(result) {
  if (typeof document === 'undefined' || !result) return Promise.resolve(null);
  const d = dialog();
  const list = d.querySelector('#route-choice-list');
  list.replaceChildren();
  d.querySelector('#route-choice-sub').textContent = result.unavailable
    ? t('Rotadan ayrılan şarj seçeneği için rota sağlayıcısından rota alınamadı ({0}). Mevcut rota değişmedi.', (result.failures || []).map((f) => f.error).filter(Boolean).slice(0, 2).join('; ') || tr('aday yok'))
    : t('Aşağıdaki seçenekler rotadan ayrılmayı gerektirir. Seçmezsen mevcut rota aynen kalır.');
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); resolve(v); };
    (result.choices || []).forEach((c) => {
      const b = el('button', 'swap-row');
      b.type = 'button';
      const L = choiceLines(c);
      b.append(el('b', 'n', L.title), el('span', 'm', L.line1), el('span', 'm', L.line2), el('span', 'm', L.line3));
      b.addEventListener('click', () => finish(c));
      list.append(b);
    });
    d.querySelector('#route-choice-keep').onclick = () => finish(null);
    d.addEventListener('close', () => finish(null), { once: true });
    d.showModal();
  });
}
