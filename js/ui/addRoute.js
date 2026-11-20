// v0.99.108 — "Rotaya Ekle" önizleme ve ONAY penceresi. Haritadaki istasyon kartından açılır (ui/stationCard.js).
// Hesap (routing/controller.js previewAddToRoute) sürerken ve önizlemede mevcut rota/navigasyon DEĞİŞMEZ; yalnızca "Onayla" uygular
// (applyAddToRoute). İptal / ✕ / Esc → hiçbir şey değişmez (süren hesabın sonucu yok sayılır). Başarısızlık açık metinle gösterilir.
import { effective } from '../state.js';
import { previewAddToRoute, applyAddToRoute } from '../routing/controller.js';
import { ADD_TEXT } from '../routing/addToRoute.js';
import { socSource } from '../physics/socEstimate.js';
import { socTrusted } from '../routing/socTrust.js';
import { renderPlanDiff } from './stopTarget.js';
import { t, tr } from '../i18n/index.js';
import { toast } from './toast.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const PROV = { tomtom: 'TomTom', mapbox: 'Mapbox', osm: 'OSM/Valhalla', google: 'Google', here: 'HERE' };
const sgn = (v, f = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(f)}`;

/** Başarısızlık/uygunsuzluk metni (çevrilmiş). */
export const addReasonText = (reason, detail = '') => t(ADD_TEXT[reason] || ADD_TEXT.plan, detail || tr('bilinmiyor'));

/** Önizleme özet satırları (DOM'suz; test edilir). */
export function addLines(pv) {
  const s = pv.stop;
  return [
    t('Yeni zorunlu durak: {0}', pv.station.name || tr('Şarj istasyonu')),
    t('Durakta %{0} → %{1} (~{2} dk şarj)', Math.round(s.arriveSoc), Math.round(s.leaveSoc), Math.round(s.minutes)),
    t('Kalan yol {0} km · sürüş {1} dk', sgn(pv.addKm, 1), sgn(pv.addMin)),
    t('Rota: {0} · istasyon ara nokta, gidiş yönünde erişim doğrulandı', PROV[pv.provider] || tr('bilinmiyor')),
    pv.elevOk && pv.wxOk ? null : tr('Rakım ya da hava alınamadı: tahmin bu verisiz.'),
    pv.socTrusted || !pv.moving ? null : tr('Pil okuması güvenilir değil: planın beklediği pil kullanıldı.'),
  ].filter(Boolean);
}

let dlg = null;
let tok = 0;
let cur = null; // { preview }

function dialog() {
  if (dlg) return dlg;
  dlg = el('dialog', 'sheet-dlg');
  dlg.id = 'add-route-dialog';
  dlg.setAttribute('aria-labelledby', 'add-route-title');
  const head = el('div', 'dlg-head');
  const h = el('h2', null, tr('Rotaya Ekle'));
  h.id = 'add-route-title';
  const x = el('button', 'sheet-x', '✕');
  x.type = 'button';
  x.id = 'add-route-x';
  x.setAttribute('aria-label', tr('Kapat'));
  head.append(h, x);
  const sub = el('p', 'small muted');
  sub.id = 'add-route-sub';
  const info = el('div', 'stack small');
  info.id = 'add-route-info';
  const diff = el('div', 'st-diff small');
  diff.id = 'add-route-diff';
  diff.setAttribute('aria-live', 'polite');
  const row = el('div', 'row');
  const cancel = el('button', 'btn', tr('İptal'));
  cancel.type = 'button';
  cancel.id = 'add-route-cancel';
  const ok = el('button', 'btn primary', tr('Onayla ve rotayı güncelle'));
  ok.type = 'button';
  ok.id = 'add-route-apply';
  row.append(cancel, ok);
  dlg.append(head, sub, info, diff, row);
  document.body.append(dlg);
  const close = () => { tok++; cur = null; if (dlg.open) dlg.close(); };
  x.addEventListener('click', close);
  cancel.addEventListener('click', close); // İptal: plan/rota/navigasyon değişmez
  dlg.addEventListener('close', () => { tok++; cur = null; });
  ok.addEventListener('click', () => {
    if (!cur?.preview) return;
    const pv = cur.preview;
    const r = applyAddToRoute(pv);
    close();
    if (!r.ok) return toast(addReasonText(r.reason), 8000);
    if (r.viaIssues?.length) return toast(t('Rota güncellendi ama durak doğrulanamadı: {0}', r.viaIssues.map((i) => i.name).join(', ')), 9000);
    toast(t('Rotaya eklendi: {0}. Mavi rota istasyondan geçiyor; sonraki duraklar yeniden hesaplandı.', pv.station.name), 7000);
  });
  return dlg;
}

/** İstasyon kartındaki "Rotaya Ekle": önizlemeyi hesapla, pencerede göster; yalnız Onayla uygular. */
export async function openAddToRoute(station) {
  if (typeof document === 'undefined') return;
  const d = dialog();
  const my = ++tok;
  cur = null;
  d.querySelector('#add-route-sub').textContent = station.name || '';
  d.querySelector('#add-route-info').replaceChildren(el('div', 'muted', tr('Gidiş yönünde erişim doğrulanıyor ve istasyon üzerinden rota hesaplanıyor…')));
  d.querySelector('#add-route-diff').replaceChildren();
  const apply = d.querySelector('#add-route-apply');
  apply.disabled = true;
  if (!d.open) d.showModal();
  const e = effective();
  const src = e.source === 'sim' ? 'sim' : socSource();
  const r = await previewAddToRoute(station, { socNow: { soc: e.soc, trusted: socTrusted(src) } });
  if (my !== tok || !d.open) return; // İptal edildi ya da yeni pencere açıldı: sonuç yok sayılır
  if (!r.ok) {
    d.querySelector('#add-route-info').replaceChildren(el('div', 'st-bad', addReasonText(r.reason, r.detail)));
    return;
  }
  cur = { preview: r.preview };
  d.querySelector('#add-route-info').replaceChildren(...addLines(r.preview).map((l) => el('div', null, l)));
  renderPlanDiff(d.querySelector('#add-route-diff'), r.preview, { meId: station.id });
  apply.disabled = false;
}
