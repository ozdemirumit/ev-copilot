// Google Routes API dönüş adımlarını rota km'sine oturtur; talimat metni Google'dan Türkçe gelir (languageCode tr-TR).

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

/** Talimat: { arrow, text (Google'ın Türkçe cümlesi), road }. Mesafe ayrıca eklenir. */
export function instruction(st) {
  let arrow = ARROW[st.modifier] || ARROW.straight;
  if (st.type === 'depart') arrow = '🚗';
  else if (st.type === 'arrive') arrow = '🏁';
  else if (st.type === 'roundabout') arrow = '🔄';
  else if (st.type === 'ferry') arrow = '⛴️';
  return { arrow, text: st.text || 'Devam edin', road: '' };
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

/** Sesli cümle: "500 metre sonra sağa dönün ..." (mesafe null ise doğrudan komut). */
export function spoken(st, distM) {
  const { text } = instruction(st);
  if (distM == null) return text;
  return `${spokenDist(distM)} sonra ${text.charAt(0).toLocaleLowerCase('tr') + text.slice(1)}`;
}
