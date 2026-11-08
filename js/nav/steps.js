// Rota dönüş adımlarını rota km'sine oturtur; talimat metni Valhalla'dan Türkçe gelir (tr-TR).

/**
 * Her adıma rota boyunca konum `km` ekle. Routes API'de manevra, adımın başındadır: konumu önceki adımların uzunluk
 * toplamıdır (geometriyle tutarlı). Toplam, profil uzunluğuna ölçeklenir (kiriş/yay farkı için küçük düzeltme).
 */
export function projectSteps(steps, profile) {
  const sum = (steps || []).reduce((a, st) => a + st.distM, 0) / 1000;
  const scale = sum > 0 ? profile.totalKm / sum : 1;
  let cum = 0;
  return (steps || []).map((st) => {
    const km = st.type === 'arrive' ? profile.totalKm : cum * scale;
    cum += st.distM / 1000;
    return { ...st, km };
  });
}

/** Sürücüye söylenmeyecek/gösterilmeyecek küçük adımlar: yol adı değişimi, düz devam, başlangıç. */
export const isMinor = (st) => st.type === 'depart' || st.type === 'notification' || !st.text
  || ((st.type === 'new name' || st.type === 'continue') && (!st.modifier || st.modifier === 'straight'));

const ARROW = {
  left: '⬅️', right: '➡️', 'slight left': '↖️', 'slight right': '↗️', 'sharp left': '↙️', 'sharp right': '↘️', straight: '⬆️', uturn: '↩️',
};

/** Kısa dönüş komutları (sözlükte 11 dilde var): yol adı ayrı bilinen dönüşlerde sağlayıcının uzun cümlesi yerine kullanılır. */
export const TURN_TR = {
  left: 'Sola dönün.', right: 'Sağa dönün.', 'slight left': 'Hafifçe sola dönün.', 'slight right': 'Hafifçe sağa dönün.',
  'sharp left': 'Keskin sola dönün.', 'sharp right': 'Keskin sağa dönün.', straight: 'Düz devam edin.', uturn: 'U dönüşü yapın.',
};

/** Yol adı ayrı biliniyorsa kısa komut: dönüşte sözlük ifadesi, diğerlerinde sondaki " (yol)" atılır; bilinmiyorsa metin aynen. */
function conciseText(st) {
  const text = st.text || 'Devam edin';
  if (!st.road) return text;
  if (st.type === 'turn' && TURN_TR[st.modifier]) return TURN_TR[st.modifier];
  const tail = ` (${st.road})`;
  return text.endsWith(tail) ? text.slice(0, -tail.length) : text;
}

/** Panel talimatı: { arrow, text (kısa komut), road (komutta geçmiyorsa yol adı) }. Mesafe ayrıca eklenir. */
export function instruction(st) {
  let arrow = ARROW[st.modifier] || ARROW.straight;
  if (st.type === 'depart') arrow = '🚗';
  else if (st.type === 'arrive') arrow = '🏁';
  else if (st.type === 'stop') arrow = '⚡';
  else if (st.type === 'roundabout') arrow = '🔄';
  else if (st.type === 'ferry') arrow = '⛴️';
  const text = conciseText(st);
  const road = st.road && !text.toLocaleLowerCase('tr').includes(st.road.toLocaleLowerCase('tr')) ? st.road : '';
  return { arrow, text, road };
}

/** Ekranda mesafe: 850 m / 2,4 km. */
export function fmtDist(m) {
  if (m >= 10000) return `${Math.round(m / 1000)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.max(0, Math.round(m / 10) * 10)} m`;
}

/** Konuşmada mesafe: "500 metre", "1,5 kilometre". */
export function spokenDist(m) {
  if (m >= 1000) return `${(Math.round(m / 500) * 0.5).toString().replace('.', ',')} kilometre`;
  return `${Math.max(50, Math.round(m / 50) * 50)} metre`;
}

const VOICE_TIERS_M = [120, 500, 2000]; // dönüşe bu kadar kala konuş (küçükten büyüğe)

/**
 * Bu adım için şimdi söylenecek ses: { key, text } ya da null. Her eşik en fazla bir kez; geçilen eşikler de "söylendi" sayılır.
 * Art arda yakın manevralarda her adımın kendi anahtarı olduğu için sonraki manevra ayrıca söylenir. Yalnızca manevra komutu konuşulur.
 */
export function dueVoice(said, idx, st, distM) {
  const tier = VOICE_TIERS_M.find((t) => distM <= t);
  if (!tier || said.has(`${idx}:${tier}`)) return null;
  VOICE_TIERS_M.filter((t) => t >= tier).forEach((t) => said.add(`${idx}:${t}`));
  return { key: `nav${idx}:${tier}`, text: spoken(st, tier === VOICE_TIERS_M[0] ? null : distM) };
}

/** Sesli cümle (panelden ayrı): "500 metre sonra sağa dönün." (mesafe null ise doğrudan komut); yol adı, süre, istasyon söylenmez. */
export function spoken(st, distM) {
  const { text } = instruction(st);
  if (distM == null) return text;
  return `${spokenDist(distM)} sonra ${text.charAt(0).toLocaleLowerCase('tr') + text.slice(1)}`;
}
