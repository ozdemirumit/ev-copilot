// İstasyon bilgisi (topluluk): 1-5 puan, çevredeki olanaklar (AVM, tuvalet, restoran…) ve fotoğraflar. Konum ~100 m hücrelere ayrılır, okurken
// komşu hücreler birlikte taranır (aynı istasyonu farklı kaynaklar biraz farklı koordinatla verebilir); yazarken kullanıcının komşu hücrelerdeki
// eski oyu silinir, böylece kişi başına tek puan / tek oy kalır. Fotoğraflar diskte (DATA_DIR/photos/<id>.jpg), üst verisi db.json'dadır.
// Kullanıcı kimlikleri yalnızca tekrarı önlemek ve silme yetkisi için tutulur, dışarı verilmez ("mine" yalnızca isteyen kişiye döner).
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const CELL = 3;
export const FACILITIES = ['mall', 'wc', 'restaurant', 'cafe', 'market', 'mosque'];
export const MAX_PHOTO_BYTES = 450_000; // istemci ~1280 px JPEG'e küçültür (≈ 100-250 KB)
const MAX_PHOTOS_PER_USER = 3; // bir istasyonda (komşu hücreler dahil) kişi başına
const MAX_PHOTOS_PER_STATION = 12;
const ID_RE = /^[a-f0-9]{16}$/;

const cellKey = (lat, lon) => `${lat.toFixed(CELL)},${lon.toFixed(CELL)}`;
const valid = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const isJpeg = (b) => b.length > 1000 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;

export function createStationInfo(store, dir) {
  const cells = () => (store.data.stationInfo ||= {});
  const cellOf = (p) => (cells()[cellKey(p.lat, p.lon)] ||= { rate: {}, fac: {}, photos: [] });
  const d = 10 ** -CELL;
  const nearKeys = (p) => { const out = []; for (const dy of [0, -d, d]) for (const dx of [0, -d, d]) out.push(cellKey(p.lat + dy, p.lon + dx)); return out; };
  const near = (p) => nearKeys(p).map((k) => [k, cells()[k]]).filter(([, c]) => c);
  const pos = (b) => ({ lat: Number(b?.lat), lon: Number(b?.lon) });
  const photoFile = (id) => join(dir, id + '.jpg');
  const rm = (id) => { try { unlinkSync(photoFile(id)); } catch { /* dosya zaten yok */ } };

  /** Özet: { rating: { avg, n, mine }, facilities: { fac: { yes, no, mine } }, photos: [{ id, mine, at }] }. */
  function summary(p, userId) {
    let sum = 0, n = 0, mine = null;
    const fac = {};
    const photos = [];
    for (const [, c] of near(p)) {
      for (const [u, v] of Object.entries(c.rate)) { sum += v; n++; if (u === userId) mine = v; }
      for (const [f, votes] of Object.entries(c.fac)) {
        const o = (fac[f] ||= { yes: 0, no: 0, mine: null });
        for (const [u, v] of Object.entries(votes)) { if (v) o.yes++; else o.no++; if (u === userId) o.mine = !!v; }
      }
      for (const ph of c.photos) photos.push({ id: ph.id, mine: ph.by === userId, at: ph.at });
    }
    photos.sort((a, b) => b.at - a.at);
    return { rating: { avg: n ? Math.round((sum / n) * 10) / 10 : null, n, mine }, facilities: fac, photos: photos.slice(0, MAX_PHOTOS_PER_STATION) };
  }

  function rate(userId, b) {
    const p = pos(b);
    const stars = Number(b?.stars);
    if (!valid(p) || !Number.isInteger(stars) || stars < 0 || stars > 5) return { error: 'geçersiz' };
    for (const [, c] of near(p)) delete c.rate[userId];
    if (stars > 0) cellOf(p).rate[userId] = stars; // 0 = puanı geri al
    store.save();
    return { ok: true };
  }

  /** has: true (var) | false (yok) | null (oyu geri al). */
  function facility(userId, b) {
    const p = pos(b);
    if (!valid(p) || !FACILITIES.includes(b?.fac) || ![true, false, null].includes(b?.has)) return { error: 'geçersiz' };
    for (const [, c] of near(p)) if (c.fac[b.fac]) delete c.fac[b.fac][userId];
    if (b.has !== null) (cellOf(p).fac[b.fac] ||= {})[userId] = b.has ? 1 : 0;
    store.save();
    return { ok: true };
  }

  function addPhoto(userId, b, buf) {
    const p = pos(b);
    if (!valid(p)) return { error: 'geçersiz konum' };
    if (!Buffer.isBuffer(buf) || buf.length > MAX_PHOTO_BYTES || !isJpeg(buf)) return { error: 'geçersiz fotoğraf' };
    const all = near(p).flatMap(([, c]) => c.photos);
    if (all.filter((x) => x.by === userId).length >= MAX_PHOTOS_PER_USER) return { error: 'bu istasyon için fotoğraf hakkın doldu' };
    if (all.length >= MAX_PHOTOS_PER_STATION) return { error: 'bu istasyonda fotoğraf sınırı doldu' };
    mkdirSync(dir, { recursive: true });
    const id = randomBytes(8).toString('hex');
    writeFileSync(photoFile(id), buf);
    cellOf(p).photos.push({ id, by: userId, at: Date.now() });
    store.save();
    return { ok: true, id };
  }

  /** Fotoğraf baytları ya da null (yok / kayıtlı değil). */
  function readPhoto(id) {
    if (!ID_RE.test(id)) return null;
    const known = Object.values(cells()).some((c) => c.photos.some((x) => x.id === id));
    if (!known || !existsSync(photoFile(id))) return null;
    return readFileSync(photoFile(id));
  }

  /** Kendi fotoğrafını (ya da yönetici herhangi birini) sil. */
  function deletePhoto(userId, id, admin) {
    if (!ID_RE.test(id)) return { error: 'geçersiz' };
    for (const c of Object.values(cells())) {
      const i = c.photos.findIndex((x) => x.id === id);
      if (i < 0) continue;
      if (c.photos[i].by !== userId && !admin) return { error: 'yetkisiz' };
      c.photos.splice(i, 1);
      rm(id);
      store.save();
      return { ok: true };
    }
    return { error: 'yok' };
  }

  /** Bir kullanıcının tüm puan, oy ve fotoğraflarını sil (hesap silme). */
  function forget(userId) {
    for (const [k, c] of Object.entries(cells())) {
      delete c.rate[userId];
      for (const votes of Object.values(c.fac)) delete votes[userId];
      for (const ph of c.photos.filter((x) => x.by === userId)) rm(ph.id);
      c.photos = c.photos.filter((x) => x.by !== userId);
      if (!Object.keys(c.rate).length && !c.photos.length && !Object.values(c.fac).some((v) => Object.keys(v).length)) delete cells()[k];
    }
    store.save();
  }

  return { summary, rate, facility, addPhoto, readPhoto, deletePhoto, forget };
}
