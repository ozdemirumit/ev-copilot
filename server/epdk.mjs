// EPDK "Şarj İstasyonları" kaydı (herkese açık, anahtarsız): tüm lisanslı istasyonların konumu, işletmecisi ve soket listesi. Fiyat ve doluluk YOKTUR.
// Liste büyüktür (≈16 MB) ve API'nin kota sınırı vardır: haftada bir indirilir, ham yanıt diske kaydedilir (yeniden işlemek için tekrar indirmek gerekmez).
// Başarısızlıkta (kota 429, ağ, bozuk yanıt) eski dosya korunur; denemeler arası bekleme dosyada tutulur (sunucu yeniden başlasa da sık denenmez).
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_DEFAULT = 'https://apigateway.epdk.gov.tr/sarjIstasyonlari';
const DAY = 86400e3;
const RETRY_MS = 3600e3; // genel hata sonrası en erken yeniden deneme
const QUOTA_RETRY_MS = 6 * 3600e3; // kota (429) sonrası
const MIN_ROWS = 1000; // bundan az kayıt dönerse yanıt eksik/bozuk sayılır, eski dosya korunur

/** GET isteği JSON gövdeyle gider (EPDK böyle ister; Node'un fetch'i GET'te gövdeye izin vermez). */
export function epdkRequest(url, { body = '{}', timeoutMs = 120000, requestImpl } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (requestImpl || (u.protocol === 'http:' ? httpRequest : httpsRequest))(u, { method: 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('EPDK zaman aşımı'), { name: 'TimeoutError' })));
    req.on('error', reject);
    req.end(body);
  });
}

/** Yanıt gövdesini doğrula: { rows } ya da hata fırlatır. */
export function parseEpdk(buf) {
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('EPDK yanıtı JSON değil'); }
  if (j?.statusCode !== 200 || !Array.isArray(j.data)) throw new Error('EPDK beklenmeyen yanıt');
  if (j.data.length < MIN_ROWS) throw new Error(`EPDK çok az kayıt döndürdü (${j.data.length})`);
  return { rows: j.data.length };
}

export function createEpdk({ dir, env = process.env, log = console, requestImpl, now = () => Date.now() }) {
  mkdirSync(dir, { recursive: true });
  const rawFile = join(dir, 'epdk-raw.json');
  const metaFile = join(dir, 'epdk-meta.json');
  const url = env.EPDK_URL || URL_DEFAULT;
  const refreshMs = Math.max(1, Number(env.EPDK_REFRESH_DAYS) || 7) * DAY;
  const off = String(env.EPDK_OFF || '') === '1';
  let meta = { fetchedAt: 0, rows: 0, lastAttemptAt: 0, lastError: '', nextTryAt: 0 };
  try { meta = { ...meta, ...JSON.parse(readFileSync(metaFile, 'utf8')) }; } catch { /* ilk çalıştırma */ }
  let running = false;
  let timer = null;

  const saveMeta = () => {
    try { const tmp = metaFile + '.tmp'; writeFileSync(tmp, JSON.stringify(meta)); renameSync(tmp, metaFile); } catch (err) { log.error('EPDK meta yazılamadı:', err.code || err.message); }
  };
  const due = () => !off && now() >= meta.nextTryAt && (!meta.fetchedAt || now() - meta.fetchedAt >= refreshMs || !existsSync(rawFile));

  /** Bir indirme denemesi. Dönüş: { ok, rows?, error? }. Aynı anda ikinci deneme başlamaz. */
  async function refresh({ force = false } = {}) {
    if (running) return { ok: false, error: 'zaten çalışıyor' };
    if (!force && !due()) return { ok: false, error: 'henüz zamanı değil' };
    running = true;
    meta.lastAttemptAt = now();
    try {
      const r = await epdkRequest(url, { requestImpl });
      if (r.status === 429) { meta.lastError = 'kota (429)'; meta.nextTryAt = now() + QUOTA_RETRY_MS; throw new Error('EPDK kota sınırı (429)'); }
      if (r.status !== 200) { meta.nextTryAt = now() + RETRY_MS; throw new Error('EPDK HTTP ' + r.status); }
      const { rows } = parseEpdk(r.body);
      const tmp = rawFile + '.tmp';
      writeFileSync(tmp, r.body);
      renameSync(tmp, rawFile); // eski dosya yalnızca doğrulanmış yeni yanıtla değişir
      meta = { fetchedAt: now(), rows, lastAttemptAt: meta.lastAttemptAt, lastError: '', nextTryAt: 0 };
      log.log(`EPDK listesi güncellendi: ${rows} istasyon, ${(r.body.length / 1048576).toFixed(1)} MB`);
      return { ok: true, rows };
    } catch (err) {
      meta.lastError = String(err.message || err).slice(0, 120);
      if (!meta.nextTryAt || meta.nextTryAt <= now()) meta.nextTryAt = now() + RETRY_MS;
      log.error('EPDK listesi alınamadı:', meta.lastError);
      return { ok: false, error: meta.lastError };
    } finally {
      running = false;
      saveMeta();
    }
  }

  /** Sunucu açılınca: ilk kontrol 1 dk sonra, sonra saatte bir (indirme yalnızca zamanı gelince ve bekleme süresi dolunca yapılır). */
  function start() {
    if (off) { log.log('EPDK listesi kapalı (EPDK_OFF=1)'); return; }
    const tick = () => refresh().catch(() => {});
    setTimeout(tick, 60e3).unref();
    timer = setInterval(tick, 3600e3);
    timer.unref();
  }

  const status = () => ({
    enabled: !off, rows: meta.rows, fetchedAt: meta.fetchedAt || null, ageDays: meta.fetchedAt ? Math.round(((now() - meta.fetchedAt) / DAY) * 10) / 10 : null,
    lastError: meta.lastError || null, nextTryAt: meta.nextTryAt || null, sizeMb: existsSync(rawFile) ? Math.round((statSync(rawFile).size / 1048576) * 10) / 10 : 0,
  });

  return { start, refresh, status, file: rawFile };
}
