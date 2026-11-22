// Daha Fazla > Saha testi kartı (v0.99.120): sürüş sırasında YALNIZ sayıları toplar (js/diag/fieldLog.js), sürüş sonunda tek dokunuşla rapor üretir.
// Varsayılan KAPALI (kayıt kapalıyken hiçbir şey toplanmaz ve gönderilmez). Konum, adres, konuşma metni ve ham OCR değeri tutulmaz.
// Rapor bu cihazda üretilir; Hata günlüğü anahtarı açıksa özet (yalnız sayılar) ayrıca otomatik gönderilir (js/diag/fieldUpload.js); kopyala/indir yine elle.
import { getState, subscribe } from '../state.js';
import { load, save } from '../utils/storage.js';
import { createFieldLog, formatReport, reportJson, deviceFamily } from '../diag/fieldLog.js';
import { onSpoken } from '../advisor/voice.js';
import { onCameraStatus } from '../sensors/camera.js';
import { fieldUploader } from '../diag/clientLogInit.js';
import { toast } from './toast.js';
import { t } from '../i18n/index.js';

const STORE_KEY = 'fieldLog';
const PERSIST_MS = 30000;
const RESUME_MAX_MS = 6 * 3600e3; // uygulama sürüş ortasında yeniden açılırsa en çok 6 saat içindeki kayıt sürdürülür

export function initFieldTest() {
  const $ = (id) => document.getElementById(id);
  const card = $('ft-card');
  if (!card) return;
  const log = createFieldLog();
  const toggle = $('ft-toggle');
  const live = $('ft-live');
  const out = $('ft-out');
  const now = () => Date.now();

  const saved = load(STORE_KEY, null);
  const wasOn = load('fieldTestOn', false);
  if (saved && log.load(saved, now()) && wasOn && now() - (saved.updatedAt ?? 0) < RESUME_MAX_MS) log.resume(now());
  toggle.checked = log.active();
  if (wasOn && !log.active()) save('fieldTestOn', false);

  const persist = () => { try { save(STORE_KEY, log.save(now())); } catch { /* depo dolu/yok: kayıt yalnız bellekte */ } };
  const meta = () => ({
    version: globalThis.APP_VERSION || '?',
    platform: deviceFamily(navigator.userAgent),
    standalone: !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone),
    at: new Date().toISOString(),
  });
  const summary = () => log.snapshot(now());
  // Otomatik gönderim (v0.99.125): Hata günlüğü anahtarı açıkken özet (yalnız sayılar) kayıt durunca, sürüş bitince, uygulama arka plana geçince ve 10 dakikada bir gider.
  // Zorlanmayanlar (arka plan, periyodik) en çok 2 dakikada bir; yükleyici ağ hatasında geri çekilir, kapalıyken hiçbir şey göndermez (js/diag/fieldUpload.js).
  const upload = (force) => { try { fieldUploader().submit(reportJson(summary(), meta()), { force }); } catch { /* gönderim kayıt/arayüzü bozmasın */ } };

  function paintLive() {
    const s = summary();
    live.textContent = !log.active() && !s.startedAt
      ? t('Kayıt kapalı')
      : t('{0} OCR okuması · %{1} geçerli · {2} sesli uyarı · {3} hata', s.ocr.reads, s.ocr.okRate == null ? '—' : Math.round(s.ocr.okRate * 100), s.spoken.total, s.errors.total);
  }

  subscribe('ocr', (o) => log.ocr(o, now()));
  subscribe('live', (l) => log.gps(l.gps, now()));
  let navWas = false;
  subscribe('nav', (n) => { log.nav(!!n.active, now()); if (navWas && !n.active && log.active()) upload(true); navWas = !!n.active; }); // sürüş bitti → özet
  subscribe('plan', (p) => log.plan(p.planId, now()));
  onSpoken((k) => log.spoken(k, now()));
  onCameraStatus((e) => log.camera(e, now()));
  window.addEventListener('error', (e) => log.error(e.message, now()));
  window.addEventListener('unhandledrejection', (e) => log.error(e.reason, now()));

  // Başlangıç tabanı: kayıt açılırken mevcut durum sayılmaz, yalnız sonraki değişiklikler
  const seed = () => { const n = now(); log.ocr(getState('ocr'), n); log.gps(getState('live').gps, n); log.nav(!!getState('nav').active, n); log.plan(getState('plan').planId, n); };

  toggle.addEventListener('change', () => {
    save('fieldTestOn', toggle.checked);
    if (toggle.checked) { log.start(now()); seed(); toast(t('Kayıt başladı')); } else { log.stop(now()); upload(true); } // kayıt durdu → özet
    persist();
    paintLive();
  });

  $('ft-show').addEventListener('click', () => {
    out.textContent = formatReport(summary(), meta());
    out.classList.remove('hidden');
  });
  $('ft-copy').addEventListener('click', async () => {
    const text = formatReport(summary(), meta());
    out.textContent = text;
    out.classList.remove('hidden');
    try { await navigator.clipboard.writeText(text); toast(t('Rapor panoya kopyalandı')); } catch { toast(t('Panoya kopyalanamadı; metni elle seçip kopyalayın')); }
  });
  $('ft-download').addEventListener('click', () => {
    const j = reportJson(summary(), meta());
    const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `evrf-saha-testi-${j.meta.at.slice(0, 16).replace(/[-:T]/g, '')}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  $('ft-reset').addEventListener('click', () => {
    log.reset(now());
    if (log.active()) seed();
    out.classList.add('hidden');
    persist();
    paintLive();
    toast(t('Saha testi sayaçları sıfırlandı'));
  });

  setInterval(() => { if (log.active()) persist(); }, PERSIST_MS);
  setInterval(() => { if (log.active()) upload(false); }, 10 * 60e3);
  setInterval(paintLive, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && log.active()) { persist(); upload(false); } }); // telefon sürüş ortasında uygulamayı kapatsa sayaçlar kaybolmasın
  window.addEventListener('pagehide', () => { if (log.active()) persist(); });
  paintLive();
}
