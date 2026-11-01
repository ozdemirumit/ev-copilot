import { getState } from '../state.js';
import { toast } from './toast.js';
import { tr } from '../i18n/index.js';

/**
 * Sürüm numarası (üst çubukta ve Daha Fazla sayfasında), sürüm notları penceresi ve güncelleme.
 * Kaynak: version.js. Yayındaki sürüm sunucudan ayrıca okunur (önbelleği atlayarak): yeni sürüm varsa üstte "Güncelle" rozeti çıkar,
 * ⓘ penceresi yayındaki en son notları gösterir (çalışan sürüm eskiyse bile). "Güncelle": service worker ve uygulama önbelleği
 * yenilenip sayfa yeniden açılır.
 */
export const APP_VERSION = globalThis.APP_VERSION || '?';

const CONFIRM_MS = 4000;
const CHECK_EVERY_MS = 20 * 60e3;

const num = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0);
const isNewer = (a, b) => { // a, b'den yeni mi?
  const x = num(a);
  const y = num(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

let remote = null; // { v, log } yayındaki sürüm

/** Yayındaki version.js'i oku (HTTP önbelleğini ve service worker'ı atlayarak). */
async function fetchRemote() {
  const res = await fetch(`version.js?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const box = {};
  new Function('self', await res.text())(box); // aynı sunucudaki kendi dosyamız: self.APP_VERSION / self.APP_CHANGELOG atar
  return { v: String(box.APP_VERSION || ''), log: box.APP_CHANGELOG || [] };
}

/**
 * Uygulamayı güncelle: service worker'dan yeni sürümü iste, eski uygulama önbelleğini sil (kütüphane önbelleği kalır:
 * Tesseract ~4 MB yeniden inmez), sayfayı yeniden aç. Bellekteki rota planı ve çalışan OCR/kamera sıfırlanır.
 */
async function updateNow() {
  toast('Güncelleniyor…', 4000);
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update(); // yeni sw.js / version.js var mı?
      const worker = reg.installing || reg.waiting;
      if (worker && worker.state !== 'activated') {
        await new Promise((resolve) => {
          worker.addEventListener('statechange', () => worker.state === 'activated' && resolve());
          setTimeout(resolve, 6000); // takılırsa yine de yenile
        });
      }
    }
  } catch { /* kayıtlı service worker yok: doğrudan yenile */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ev-copilot-') && !k.includes('vendor')).map((k) => caches.delete(k)));
  } catch { /* önbellek API'si yok */ }
  location.reload();
}

export function initVersionInfo() {
  const $ = (id) => document.getElementById(id);
  const local = globalThis.APP_CHANGELOG || [];
  $('btn-version').textContent = 'v' + APP_VERSION;
  $('about-version').textContent = 'v' + APP_VERSION;
  $('ver-line').textContent = tr('Sürüm v') + APP_VERSION;
  // Hangi kaynaktan çalıştığımızı göster (sorun giderme): APK canlı siteyi yüklüyorsa adres github.io, eski gömülü APK'da localhost olur
  const native = !!globalThis.Capacitor?.isNativePlatform?.();
  $('ver-env').textContent = `${native ? 'APK' : 'web'} · ${location.host}`;

  const renderLog = (log) => {
    const list = $('changelog');
    list.replaceChildren();
    log.forEach((entry) => {
      const h = document.createElement('h3');
      h.textContent = `v${entry.v} · ${entry.date}`;
      const ul = document.createElement('ul');
      entry.notes.forEach((n) => ul.append(Object.assign(document.createElement('li'), { textContent: n })));
      list.append(h, ul);
    });
  };
  renderLog(local);

  const confirmBusy = () => {
    const busy = getState('system').ocr || getState('plan').status === 'ready';
    return !busy || confirm('Güncelleyince sayfa yenilenir; aktif plan ve OCR sıfırlanır. Devam edilsin mi?');
  };
  const doUpdate = () => { if (confirmBusy()) updateNow(); };

  const paint = (state) => {
    const newer = remote && isNewer(remote.v, APP_VERSION);
    $('btn-update').classList.toggle('hidden', !newer);
    $('btn-update').textContent = newer ? `⬆ Güncelle v${remote.v}` : '';
    $('ver-update').classList.toggle('hidden', !newer);
    $('ver-latest').textContent = state === 'checking' ? 'Yayındaki sürüm denetleniyor…'
      : state === 'error' ? 'Yayındaki sürüm denetlenemedi (internet?)'
        : !remote ? 'Yayındaki sürüm denetlenmedi'
          : newer ? `Yeni sürüm var: v${remote.v}. "Güncelle"ye dokun.`
            : `Güncelsin (yayındaki sürüm v${remote.v}).`;
    $('about-latest').textContent = remote ? (newer ? `Yayındaki en son sürüm: v${remote.v} (şu an v${APP_VERSION}). Notlar yayındaki sürümdendir.` : `Güncelsin: yayındaki sürüm v${remote.v}.`) : '';
    $('about-update').classList.toggle('hidden', !newer);
    renderLog(newer ? remote.log : local);
  };

  async function check() {
    paint('checking');
    try {
      remote = await fetchRemote();
      paint('ok');
    } catch {
      paint(remote ? 'ok' : 'error');
    }
  }

  $('btn-update').addEventListener('click', doUpdate);
  $('ver-update').addEventListener('click', doUpdate);
  $('about-update').addEventListener('click', doUpdate);
  $('ver-check').addEventListener('click', check);

  // ⓘ: sürüm notları (yenilemeyi tetiklemez); açılırken yayındaki sürümü de denetler
  const dlg = $('about-dialog');
  const openNotes = (e) => { e?.stopPropagation(); dlg.showModal(); check(); };
  $('btn-notes').addEventListener('click', openNotes);
  $('ver-notes').addEventListener('click', openNotes);
  $('about-close').addEventListener('click', () => dlg.close());
  $('about-x').addEventListener('click', () => dlg.close());

  // Açılışta, her 20 dakikada ve uygulamaya dönülünce yeni sürüm var mı bak
  setTimeout(check, 3000);
  setInterval(() => { if (!document.hidden) check(); }, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });

  // Başlığa veya sürüm numarasına dokun → yenile
  const brand = $('brand');
  let armed = null;
  const onTap = () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
      return updateNow();
    }
    const busy = getState('system').ocr || getState('plan').status === 'ready';
    if (!busy) return updateNow(); // kaybedilecek bir şey yok: hemen yenile
    toast('Yenilemek için tekrar dokun (aktif plan / OCR sıfırlanır)', CONFIRM_MS);
    armed = setTimeout(() => { armed = null; }, CONFIRM_MS);
  };
  brand.addEventListener('click', onTap);
  brand.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } });
}
