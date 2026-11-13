// Günlük/yanıt gizli değer temizleyicisi (saf, ağ yok). .env'deki gizli değerler metinde geçerse '***' ile değiştirilir.
// Değerler asla yazdırılmaz; yalnızca değişken ADLARI burada listelenir. Yeni bir gizli .env değişkeni eklenirse buraya da eklenmeli.
export const SECRET_ENV_NAMES = [
  'MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN', 'OCM_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_CLIENT_SECRET',
  'HERE_API_KEY', 'HERE_ACCESS_KEY_ID', 'HERE_ACCESS_KEY_SECRET', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'VERIAPI_KEY',
  'ADMIN_TOTP_SECRET', 'SMTP_PASS',
];
// Virgülle ayrılmış listeler: her öğe ayrı gizli değerdir (ör. yönetici erişim kodları).
export const SECRET_LIST_ENV_NAMES = ['ACCESS_CODES'];

/** env'deki gizli değerler (boşlar atılır; uzun olan önce: biri ötekini içeriyorsa tamamı maskelenir). */
export function secretValues(env = {}) {
  const vals = new Set();
  for (const k of SECRET_ENV_NAMES) { const v = String(env[k] ?? '').trim(); if (v) vals.add(v); }
  for (const k of SECRET_LIST_ENV_NAMES) for (const v of String(env[k] ?? '').split(',')) { const t = v.trim(); if (t) vals.add(t); }
  return [...vals].sort((a, b) => b.length - a.length);
}

/** (s) => s içindeki gizli değerleri '***' yapan işlev. Değerler env'den bir kez okunur. */
export function makeScrub(env = {}) {
  const secrets = secretValues(env);
  return (s) => { let t = String(s); for (const secret of secrets) t = t.split(secret).join('***'); return t; };
}
