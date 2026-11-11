// İşletmecilerin yayımladığı genel kWh tarifeleri: sunucudan (GET /v1/tariffs, VeriApi.Pro) günde en çok bir kez alınır ve operatör tablosuna işlenir
// (operators.js setPublishedTariffs). Giriş gerekir (Premium değil). Sunucu yoksa, anahtar kapalıysa ya da hata olursa sessizce atlanır: eski liste fiyatı kalır.
import { getSession, proxyFetch } from '../net/proxy.js';
import { setPublishedTariffs, publishedTariffsAt } from './operators.js';

const TTL_MS = 24 * 3600e3;
let busy = false;

export async function refreshTariffs() {
  if (busy || !getSession()) return false;
  const at = publishedTariffsAt();
  if (at && Date.now() - at < TTL_MS) return false;
  busy = true;
  try {
    const res = await proxyFetch('/v1/tariffs', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return false;
    const body = await res.json();
    if (!Array.isArray(body?.operators) || !body.operators.length) return false;
    setPublishedTariffs(body.operators, Number(body.at) || Date.now());
    return true;
  } catch { return false; } finally { busy = false; }
}

export function initTariffs() {
  refreshTariffs();
  document.addEventListener('account-changed', () => refreshTariffs());
}
