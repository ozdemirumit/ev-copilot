// Topluluk doluluğu (istemci): şarj etmeye başlayınca/bitirince herkese açık istasyonda "varlık" bildirilir (anonim; yalnızca eşleşen istasyon
// konumu gider, ev/iş gibi kayıtsız yerler hiç gitmez), kullanıcı "Dolu / Boş" bildirebilir. Paylaşım Hesap kartından kapatılabilir.
import { load, save } from '../utils/storage.js';
import { getSession, proxyFetch } from '../net/proxy.js';

export const sharingOn = () => load('shareCharging', true);
export const setSharing = (v) => save('shareCharging', !!v);

async function post(path, body) {
  const r = await proxyFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return r.ok;
}

/** state: 'start' | 'stop'; st: eşleşen istasyon { lat, lon }. Sessizce başarısız olabilir. */
export function sharePresence(state, st) {
  if (!getSession() || !sharingOn() || !st) return;
  post('/v1/presence', { lat: st.lat, lon: st.lon, state }).catch(() => {});
}

/** status: 'full' | 'free'. Dönüş: başarılı mı. */
export async function reportStatus(st, status) {
  if (!getSession()) return false;
  try { return await post('/v1/status', { lat: st.lat, lon: st.lon, status }); } catch { return false; }
}
