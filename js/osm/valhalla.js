// Valhalla'ya (OpenStreetMap yol verisi; FOSSGIS herkese açık sunucusu, anahtarsız) JSON POST. Rota (/route), rakım (/height) ve yol hız limiti
// (/locate) bunu kullanır. Herkese açık demo sunucu: adil kullanım, garanti yok.
import { publicFreeMode, PUBLIC_CLIENT_ID } from '../net/providerGate.js';

export const VALHALLA = 'https://valhalla1.openstreetmap.de';
/** İstek başlıkları. Herkese açık ücretsiz Beta'da demo sunucunun son kullanıcı uygulamalarından istediği tanıtıcı X-Client-Id eklenir. */
export const valhallaHeaders = () => (publicFreeMode() ? { 'Content-Type': 'application/json', 'X-Client-Id': PUBLIC_CLIENT_ID } : { 'Content-Type': 'application/json' });

export async function valhalla(path, body, timeoutMs = 45000) {
  let res;
  try {
    res = await fetch(VALHALLA + path, {
      method: 'POST',
      headers: valhallaHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? 'Ücretsiz yol sunucusu yanıt vermedi (zaman aşımı)' : 'Ücretsiz yol sunucusuna ulaşılamadı (internet?)');
  }
  if (res.ok) return res.json();
  let msg = '';
  try { msg = (await res.json()).error || ''; } catch { /* gövde yok */ }
  if (res.status === 429) throw new Error('Ücretsiz yol sunucusu istek sınırına ulaştı, biraz bekle');
  if (/no suitable edges|no path|Location at index/i.test(msg)) throw new Error('Rota bulunamadı: başlangıç/varış yola yakın değil veya bağlantı yok');
  throw new Error(msg ? `Yol sunucusu: ${msg}` : `Yol sunucusu HTTP ${res.status}`);
}
