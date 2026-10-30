import { getState } from '../state.js';
import { toast } from './toast.js';

/** Sürüm numarası (üst çubukta), sürüm notları penceresi ve "başlığa/sürüme dokun → yenile". Kaynak: version.js. */
export const APP_VERSION = globalThis.APP_VERSION || '?';

const CONFIRM_MS = 4000;

/**
 * Uygulamayı yenile: service worker'dan yeni sürümü iste, yüklenince sayfayı yeniden aç. Bellekteki rota planı ve çalışan
 * OCR/kamera sıfırlanır; bu yüzden aktif plan/OCR varken yanlışlıkla dokunmaya karşı iki dokunuş ister (ilk dokunuş uyarır).
 */
async function refreshApp() {
  toast('Güncelleniyor…', 3000);
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update(); // yeni sw.js / version.js var mı?
      const worker = reg.installing || reg.waiting;
      if (worker && worker.state !== 'activated') {
        await new Promise((resolve) => {
          worker.addEventListener('statechange', () => worker.state === 'activated' && resolve());
          setTimeout(resolve, 5000); // takılırsa yine de yenile
        });
      }
    }
  } catch { /* kayıtlı service worker yok: doğrudan yenile */ }
  location.reload();
}

export function initVersionInfo() {
  const $ = (id) => document.getElementById(id);
  const log = globalThis.APP_CHANGELOG || [];
  $('btn-version').textContent = 'v' + APP_VERSION;
  $('about-version').textContent = 'v' + APP_VERSION;

  const list = $('changelog');
  list.replaceChildren();
  log.forEach((entry) => {
    const h = document.createElement('h3');
    h.textContent = `v${entry.v} · ${entry.date}`;
    const ul = document.createElement('ul');
    entry.notes.forEach((n) => ul.append(Object.assign(document.createElement('li'), { textContent: n })));
    list.append(h, ul);
  });

  // ⓘ: sürüm notları (yenilemeyi tetiklemez)
  const dlg = $('about-dialog');
  $('btn-notes').addEventListener('click', (e) => { e.stopPropagation(); dlg.showModal(); });
  $('about-close').addEventListener('click', () => dlg.close());

  // Başlığa veya sürüm numarasına dokun → yenile
  const brand = $('brand');
  let armed = null;
  const onTap = () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
      return refreshApp();
    }
    const busy = getState('system').ocr || getState('plan').status === 'ready';
    if (!busy) return refreshApp(); // kaybedilecek bir şey yok: hemen yenile
    toast('Yenilemek için tekrar dokun (aktif plan / OCR sıfırlanır)', CONFIRM_MS);
    armed = setTimeout(() => { armed = null; }, CONFIRM_MS);
  };
  brand.addEventListener('click', onTap);
  brand.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } });
}
