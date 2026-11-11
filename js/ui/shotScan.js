// Pili araç uygulamasının (ör. Trumore) widget/ekran görüntüsünden okur: 🖼️ düğmesi görüntü seçtirir, OCR cihazda çalışır (görüntü hiçbir yere gitmez),
// okunan yüzde onay penceresinde düzenlenebilir; eski veri (damga bir saatten eski) uyarılır. Onaylanan değer elle pil ile aynı yoldan yazılır.
import { getState, patch } from '../state.js';
import { setManual, manualLocked } from '../physics/socEstimate.js';
import { setStartSoc } from '../routing/controller.js';
import { readShot } from '../sensors/shotOcr.js';
import { ageHours, isStale } from '../sensors/shotParse.js';
import { t, tr } from '../i18n/index.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Okunan değeri elle pil gibi uygular (Test Modu açıksa sim pili). */
export function applyShotSoc(v) {
  const next = clamp(Math.round(v), 0, 100);
  if (getState('sim').enabled) patch('sim', { soc: next });
  else setManual(next);
  setStartSoc(next);
  return next;
}

/** Eski veri uyarısı metni; güncel ya da damgasız ise ilgili ipucu. */
export function warnText(r, now = Date.now()) {
  if (r.at && isStale(r.at, now)) {
    const h = ageHours(r.at, now);
    const when = r.at.toLocaleString();
    return h >= 48
      ? t('Görüntüdeki veri yaklaşık {0} gün önceki ({1}): aracın şu anki durumunu göstermeyebilir.', Math.round(h / 24), when)
      : t('Görüntüdeki veri yaklaşık {0} saat önceki ({1}): aracın şu anki durumunu göstermeyebilir.', Math.round(h), when);
  }
  if (!r.at) return tr('Görüntüde zaman damgası bulunamadı: verinin güncel olduğundan emin ol.');
  return '';
}

export function initShotScan() {
  const dlg = $('shot-dialog');
  const file = $('shot-file');
  if (!dlg || !file) return;
  const status = $('shot-status');
  const result = $('shot-result');
  const input = $('shot-soc');
  const apply = $('shot-apply');
  let seq = 0;
  let last = null;

  const step = (d) => { input.value = String(clamp((Number.isFinite(Number(input.value)) ? Number(input.value) : 0) + d, 0, 100)); };
  const pick = () => {
    if (!getState('sim').enabled && manualLocked()) return toast(tr('Kamera pili canlı okuyor: ekran görüntüsü gerekmez'));
    file.click();
  };
  $('soc-sheet-shot')?.addEventListener('click', pick);
  $('shot-plus').addEventListener('click', () => step(1));
  $('shot-minus').addEventListener('click', () => step(-1));
  $('shot-x').addEventListener('click', () => dlg.close());
  $('shot-close').addEventListener('click', () => dlg.close());
  $('shot-other').addEventListener('click', pick);
  dlg.addEventListener('close', () => { seq++; last = null; });

  apply.addEventListener('click', () => {
    const v = Number(input.value);
    if (input.value === '' || !Number.isFinite(v)) return toast(tr('Geçerli bir pil yüzdesi gir'));
    const next = applyShotSoc(v);
    dlg.close();
    toast(t('Pil %{0} olarak ayarlandı', next));
  });

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = ''; // aynı görüntü yeniden seçilebilsin
    if (!f) return;
    const my = ++seq;
    result.classList.add('hidden');
    $('shot-other').classList.add('hidden');
    status.textContent = tr('Okunuyor… (ilk seferde OCR motoru iner)');
    if (!dlg.open) dlg.showModal();
    try {
      last = await readShot(f, (s) => { if (my === seq) status.textContent = tr(s === 'prep' ? 'Görüntü hazırlanıyor…' : 'Okunuyor…'); });
    } catch (err) {
      if (my === seq) { status.textContent = t('Okuma başarısız: {0}', err.message || err.name); $('shot-other').classList.remove('hidden'); }
      return;
    }
    if (my !== seq) return;
    $('shot-other').classList.remove('hidden');
    if (last.soc == null) {
      status.textContent = tr('Görüntüde pil yüzdesi (%) bulunamadı. Yüzde ve araç adının göründüğü bir widget ya da uygulama ekranı seç.');
      return;
    }
    status.textContent = tr('Okundu. Değeri aracınızdakiyle karşılaştır, gerekirse düzelt.');
    input.value = String(last.soc);
    const parts = [];
    if (last.rangeKm != null) parts.push(t('Menzil: {0} km', last.rangeKm));
    if (last.at) parts.push(t('Son güncelleme: {0}', last.at.toLocaleString()));
    $('shot-extra').textContent = parts.join(' · ');
    const warns = [warnText(last)];
    if (last.ambiguous) warns.push(tr('Birden çok yüzde bulundu: değeri kontrol et.'));
    $('shot-warn').textContent = warns.filter(Boolean).join(' ');
    apply.textContent = tr(last.at && isStale(last.at) ? 'Yine de uygula' : 'Pili uygula');
    result.classList.remove('hidden');
  });
}
