// v0.99.99 — Pil değişince önerilen plan penceresi. Yönlendirme katmanı (livePlan) kararlı ve güvenilir pil değerinde öneri hazırlar
// (ağ yok, plan değişmez); burada kaynağı (kamera ham/doğrulanmış okuma, güven, son okuma yaşı ya da elle giriş) ve plan farkı gösterilir.
// Plan YALNIZCA "Onayla" ile değişir (applyStopTarget: önizlemeden sonra plan değiştiyse reddedilir). İptal / kapatma / Esc → mevcut plan kalır.
import { getState } from '../state.js';
import { applyStopTarget } from '../routing/controller.js';
import { setProposalSink } from '../routing/socReplan.js';
import { renderPlanDiff } from './stopTarget.js';
import { t, tr } from '../i18n/index.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
let cur = null; // { preview, onDone, done }

function finish(applied) {
  if (!cur || cur.done) return;
  cur.done = true;
  cur.onDone?.(applied);
}

/** Pil kaynağı satırı: elle giriş ya da kamera (ham okuma ayrı, doğrulanmış değer, güven, son okuma yaşı). */
function sourceText(source) {
  if (source === 'manual') return tr('Kaynak: elle girilen pil (bir sonraki güvenilir kamera okumasına kadar geçerli)');
  if (source === 'sim') return tr('Kaynak: Test Modu');
  const o = getState('ocr');
  const age = o.readAt ? Math.round((Date.now() - o.readAt) / 1000) : null;
  const parts = [t('Kaynak: kamera — doğrulanmış %{0}', o.accepted ?? '—')];
  if (o.raw != null && o.raw !== o.accepted) parts.push(t('ham okuma {0}', o.raw));
  if (o.reliability) parts.push(t('güven %{0}', Math.round(o.reliability)));
  if (age != null) parts.push(t('{0} sn önce', age));
  return parts.join(' · ');
}

function show({ preview, why, source, onDone }) {
  const dlg = $('soc-replan-dialog');
  if (!dlg) { onDone?.(false); return; }
  if (cur && !cur.done) finish(false);
  cur = { preview, onDone, done: false };
  $('sr-sub').textContent = why === 'charge'
    ? t('Şarj planlanandan farklı bitti: ayrılışta pil %{0}.', Math.round(preview.soc))
    : t('Pil %{0} okundu; plan beklentisinden farklı.', Math.round(preview.soc));
  $('sr-src').textContent = sourceText(source);
  renderPlanDiff($('sr-diff'), preview);
  if (!dlg.open) dlg.showModal();
}

export function initSocReplan() {
  const dlg = $('soc-replan-dialog');
  if (!dlg) return;
  const close = () => { finish(false); dlg.close(); }; // İptal: aktif plan aynen kalır
  $('sr-x').addEventListener('click', close);
  $('sr-cancel').addEventListener('click', close);
  dlg.addEventListener('close', () => finish(false));
  $('sr-apply').addEventListener('click', () => {
    if (!cur?.preview || cur.done) return;
    const r = applyStopTarget(cur.preview); // aynı onay/bayatlık denetimi (planId + tripSeq)
    if (!r.ok) { toast(tr(r.reason), 7000); finish(false); dlg.close(); return; }
    finish(true);
    dlg.close();
    toast(tr('Plan güncel pile göre yeniden hesaplandı.'), 6000);
  });
  setProposalSink(show);
}
