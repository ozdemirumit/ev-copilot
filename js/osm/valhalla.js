// Valhalla'ya (OpenStreetMap yol verisi; FOSSGIS herkese açık sunucusu, anahtarsız) JSON POST. Rakım (/height) ve yol hız limiti
// (/locate) bunu kullanır. Herkese açık demo sunucu: adil kullanım, garanti yok.
export const VALHALLA = 'https://valhalla1.openstreetmap.de';

export async function valhalla(path, body, timeoutMs = 45000) {
  let res;
  try {
    res = await fetch(VALHALLA + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  throw new Error(msg ? `Yol sunucusu: ${msg}` : `Yol sunucusu HTTP ${res.status}`);
}
