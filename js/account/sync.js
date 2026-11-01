// Hesapla senkron: ayarlar, favoriler, son hedefler, araç ve tüketim geçmişi cihazlar arasında eşitlenir.
//  - değişen anahtar (SYNC_KEYS) birkaç saniye sonra sunucuya gönderilir; açılışta ve uygulamaya dönünce sunucudaki yenisi alınır;
//  - çakışmada son yazan kazanır; tüketim ölçümleri (hist) ve son hedefler birleştirilir (kayıp olmasın);
//  - alınan veri modüller açılışta okuduğu için, değişiklik varsa sayfa bir kez yenilenir.
// Gizli olanlar (ABRP, API anahtarları, oturum, sunucu adresi) hiç eşitlenmez.
import { load, save, onSave } from '../utils/storage.js';
import { getSession, proxyFetch } from '../net/proxy.js';
import { toast } from '../ui/toast.js';

export const SYNC_KEYS = [
  'places', 'recentDest', 'vehicle', 'consAdj', 'chargerMin', 'minStopAdd', 'tolerance', 'maxChargeTo', 'allowSlow', 'minArrival', 'cruise',
  'planMode', 'voiceOn', 'lowSoc', 'speedAlert', 'headingUp', 'limitOn', 'operators', 'kCal', 'hist', 'customStations', 'stationOps', 'nearRadius', 'nearAc',
];
const SET = new Set(SYNC_KEYS);
const PUSH_DELAY_MS = 4000;
const PULL_EVERY_MS = 10 * 60e3;

const meta = () => load('syncMeta', {}); // anahtar → son değişiklik zamanı (ms)
const setMeta = (m) => save('syncMeta', m, { silent: true });
const dirty = new Set(load('syncDirty', []));
const saveDirty = () => save('syncDirty', [...dirty], { silent: true });
let timer = null;
let lastPull = 0;
export const syncState = { at: load('syncAt', 0), busy: false, error: '' };
const note = () => document.dispatchEvent(new Event('sync-changed'));

/** Birleştirilen anahtarlar: yerel ve uzak kayıtları kaybetmeden tek listede toplar. */
const MERGE = {
  hist: (a, b) => {
    const seen = new Map();
    for (const r of [...(a || []), ...(b || [])]) seen.set(r.t, r);
    return [...seen.values()].sort((x, y) => x.t - y.t).slice(-400);
  },
  recentDest: (a, b) => {
    const out = [];
    for (const d of [...(a || []), ...(b || [])].sort((x, y) => y.at - x.at)) if (!out.some((o) => o.label === d.label)) out.push(d);
    return out.slice(0, 8);
  },
};

export function initSync() {
  onSave((key) => {
    if (!SET.has(key) || !getSession()) return;
    const m = meta();
    m[key] = Date.now();
    setMeta(m);
    dirty.add(key);
    saveDirty();
    schedule();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getSession() && Date.now() - lastPull > PULL_EVERY_MS) syncNow();
  });
  document.addEventListener('account-changed', () => { if (getSession()) syncNow(); });
  if (getSession()) syncNow();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => push().catch(() => {}), PUSH_DELAY_MS);
}

async function push() {
  if (!getSession() || !dirty.size) return;
  const m = meta();
  for (const key of [...dirty]) {
    const value = load(key, null);
    if (value === null) { dirty.delete(key); continue; }
    const r = await proxyFetch(`/v1/sync/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ u: m[key] || Date.now(), v: value }), signal: AbortSignal.timeout(20000),
    });
    if (r.ok || r.status === 409 || r.status === 413 || r.status === 400) dirty.delete(key); // 409: sunucudaki daha yeni, bir sonraki çekişte alınır
    else throw new Error('HTTP ' + r.status);
  }
  saveDirty();
}

/** Sunucudaki verileri al, yerel değişiklikleri gönder. Dönüş: sayfa yenilendiyse true. */
export async function syncNow() {
  if (!getSession() || syncState.busy) return false;
  syncState.busy = true;
  syncState.error = '';
  note();
  let reload = false;
  try {
    const r = await proxyFetch('/v1/sync', { signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { docs } = await r.json();
    const m = meta();
    let changed = false;
    for (const key of SYNC_KEYS) {
      const remote = docs[key];
      const local = load(key, null);
      const lu = m[key] || 0;
      if (remote && (local === null || remote.u > lu)) {
        const merged = MERGE[key] && local !== null ? MERGE[key](local, remote.v) : remote.v;
        if (JSON.stringify(merged) !== JSON.stringify(local)) { save(key, merged, { silent: true }); changed = true; }
        m[key] = remote.u;
        if (MERGE[key] && JSON.stringify(merged) !== JSON.stringify(remote.v)) { dirty.add(key); m[key] = Date.now(); } // birleşim sunucudakinden farklı: geri gönder
      } else if (local !== null && (!remote || lu > remote.u)) {
        m[key] = lu || Date.now();
        dirty.add(key); // yerel daha yeni ya da sunucuda yok: gönderilecek
      }
    }
    setMeta(m);
    saveDirty();
    await push();
    lastPull = Date.now();
    syncState.at = lastPull;
    save('syncAt', lastPull, { silent: true });
    if (changed && Date.now() - Number(sessionStorage.getItem('evcp.syncReloaded') || 0) > 120000) { // kısa sürede döngüye girmesin
      sessionStorage.setItem('evcp.syncReloaded', String(Date.now()));
      toast('Hesap verileri alındı, yenileniyor…', 2500);
      reload = true;
      setTimeout(() => location.reload(), 1200);
    }
  } catch (err) {
    syncState.error = err.message || String(err);
  } finally {
    syncState.busy = false;
    note();
  }
  return reload;
}
