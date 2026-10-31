// OSRM dönüş adımlarını rota km'sine oturtur ve Türkçe talimata çevirir (saf fonksiyonlar).

/**
 * Her adıma rota boyunca konum `km` ekle. OSRM'de manevra, adımın başındadır: konumu önceki adımların uzunluk toplamıdır
 * (geometriyle birebir tutarlı). Toplam, profil uzunluğuna ölçeklenir (haversine ile OSRM mesafesi arasındaki küçük fark).
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
export const isMinor = (st) => st.type === 'depart' || st.type === 'notification'
  || ((st.type === 'new name' || st.type === 'continue') && (!st.modifier || st.modifier === 'straight'));

const DIR = {
  left: 'sola', right: 'sağa', 'slight left': 'hafif sola', 'slight right': 'hafif sağa',
  'sharp left': 'keskin sola', 'sharp right': 'keskin sağa',
};
const ARROW = {
  left: '⬅️', right: '➡️', 'slight left': '↖️', 'slight right': '↗️', 'sharp left': '↙️', 'sharp right': '↘️', straight: '⬆️', uturn: '↩️',
};
const isLeft = (m) => /left/.test(m || '');
const isRight = (m) => /right/.test(m || '');

/** Talimat: { arrow, text (ekranda, büyük harfsiz), road (yol adı) }. Mesafe ayrıca eklenir. */
export function instruction(st) {
  const m = st.modifier;
  const dir = DIR[m];
  const arrow = ARROW[m] || ARROW.straight;
  const road = st.name || '';
  switch (st.type) {
    case 'depart': return { arrow: '🚗', text: 'Yola çıkın', road };
    case 'arrive': return { arrow: '🏁', text: isLeft(m) ? 'Varış noktası solda' : isRight(m) ? 'Varış noktası sağda' : 'Varış noktasına ulaştınız', road: '' };
    case 'turn':
      if (m === 'uturn') return { arrow: ARROW.uturn, text: 'U dönüşü yapın', road };
      if (m === 'straight' || !dir) return { arrow: ARROW.straight, text: 'Düz devam edin', road };
      return { arrow, text: `${dir} dönün`, road };
    case 'end of road':
      if (!dir) return { arrow: ARROW.straight, text: 'Yolun sonunda dönün', road };
      return { arrow, text: `Yolun sonunda ${dir} dönün`, road };
    case 'merge': return { arrow, text: 'Yola katılın', road };
    case 'on ramp': return { arrow, text: dir ? `${dir} bağlantı yoluna girin` : 'Bağlantı yoluna girin', road };
    case 'off ramp':
      return { arrow, text: isLeft(m) ? 'Soldaki çıkışı kullanın' : isRight(m) ? 'Sağdaki çıkışı kullanın' : 'Çıkışı kullanın', road };
    case 'fork':
      return { arrow, text: isLeft(m) ? 'Çatalda solda kalın' : isRight(m) ? 'Çatalda sağda kalın' : 'Çatalda düz devam edin', road };
    case 'roundabout':
    case 'rotary':
      return { arrow: '🔄', text: st.exit ? `Kavşakta ${st.exit}. çıkıştan çıkın` : 'Kavşağa girin', road };
    case 'roundabout turn':
      return { arrow, text: dir ? `Kavşakta ${dir} dönün` : 'Kavşakta düz devam edin', road };
    case 'exit roundabout':
    case 'exit rotary': return { arrow: ARROW.straight, text: 'Kavşaktan çıkın', road };
    default:
      if (dir) return { arrow, text: `${dir} devam edin`, road };
      return { arrow: ARROW.straight, text: 'Düz devam edin', road };
  }
}

/** Ekranda mesafe: 850 m / 2,4 km. */
export function fmtDist(m) {
  if (m >= 10000) return `${Math.round(m / 1000)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.max(0, Math.round(m / 10) * 10)} m`;
}

/** Konuşmada mesafe: "iki" yerine rakam okunur: "500 metre", "1,5 kilometre". */
export function spokenDist(m) {
  if (m >= 1000) return `${(Math.round(m / 500) * 0.5).toString().replace('.', ',')} kilometre`;
  return `${Math.max(50, Math.round(m / 50) * 50)} metre`;
}

/** Sesli cümle: "500 metre sonra sağa dönün, Atatürk Caddesi" (mesafe null ise doğrudan komut). */
export function spoken(st, distM) {
  const { text, road } = instruction(st);
  const cmd = text.charAt(0).toLocaleLowerCase('tr') + text.slice(1);
  const tail = road && !/^(arrive|depart)$/.test(st.type) ? `, ${road}` : '';
  if (distM == null) return text + tail;
  return `${spokenDist(distM)} sonra ${cmd}${tail}`;
}
