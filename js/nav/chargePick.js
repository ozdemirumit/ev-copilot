// Düşük pil önerisi: üst panelde tek kart olarak gösterilecek istasyonu seçer. DOM kullanmaz (test edilebilir).
// Kural: gücü kesin bilinen, 150 kW'tan BÜYÜK, güvenle ulaşılabilir, dolu/arızalı olmayan istasyonlar içinde gerçek fiyatı bilinen en ucuz.
// Fiyat uydurulmaz: "Diğer" ortalaması ve keşfedilen markaya kopyalanan ortalama bilinmeyen fiyat sayılır; en az iki fiyat karşılaştırılamıyorsa "en ucuz" denmez.
import { slotKind, livePrice } from '../routing/slots.js';

export const MIN_FAST_KW = 150; // kesin büyük: tam 150 kW uygun değil
export const SAFE_ARRIVE_SOC = 5; // öneriye varışta en az bu kadar pil kalmalı (rotayı kendiliğinden güncelleme eşiğiyle aynı)
export const ROUTE_OFF_KM = 5; // planlı rotada yoldan en çok bu kadar uzak istasyon "rota üstü" sayılır
export const ROUTE_NEAR_KM = 15; // yol üstünde olmasa da bu kadar yakın istasyon önerilebilir (arkada kalsa bile)

/** Kaynağın bildirdiği güç (kW); operatör tablosundan varsayılan güç ise null. */
export function knownKw(s) {
  return s.uncertain || s.srcKw == null ? null : s.srcKw;
}

export const isFast = (s) => !s.slow && (knownKw(s) ?? 0) > MIN_FAST_KW;

/** Karşılaştırılabilir kWh fiyatı: { value, currency, comparable } ya da null (bilinmiyor). Ek ücretli (oturum/süre) canlı tarife kWh ile karşılaştırılamaz. */
export function priceInfo(s) {
  const p = s.slots?.price;
  if (p?.kwh > 0 && p.currency) return { value: p.kwh, currency: p.currency, comparable: !(p.flat || p.hour || p.parkingHour) };
  if (s.tariff === 'list' && s.price > 0) return { value: s.price, currency: 'TRY', comparable: true };
  return null;
}

/** Karttaki fiyat metni; gerçek fiyat yoksa açıkça "Fiyat bilinmiyor". Kelime çevirisi metin düğümü üzerinden yapılır. */
export function priceText(s) {
  const lp = livePrice(s);
  if (lp && s.slots.price.kwh > 0) return lp.text + (lp.extra ? ' + ek ücret' : '');
  return priceInfo(s) ? `${s.price.toFixed(2)} TL/kWh (liste)` : 'Fiyat bilinmiyor';
}

/** Karşılaştırmaya girecek para birimi: en çok fiyatı olan (eşitlikte listede önce gelen). Farklı para birimleri birbiriyle sıralanmaz. */
function mainCurrency(priced) {
  const n = new Map();
  for (const x of priced) n.set(x.info.currency, (n.get(x.info.currency) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * stations: en uygundan (yakın, yol üstü) sıralı aday listesi; onRoute/brandOk çağıran tarafça verilir.
 * Dönüş: { station, kind, fast }. kind: 'cheapest' (tüm adayların fiyatı biliniyor) | 'cheapestKnown' (bazı adayların fiyatı yok) |
 * 'nearestFast' (fiyatlar karşılaştırılamıyor) | 'none' (uygun 150 kW üstü yok; station null). fast: uygun hızlı istasyonlar, önerilen önce.
 * Marka tercihi yumuşaktır: tercih edilen markada uygun hızlı istasyon yoksa tüm markalar kullanılır.
 */
export function pickEmergency(stations, { onRoute = () => true, brandOk = () => true } = {}) {
  const suitable = stations.filter((s) => {
    const k = slotKind(s);
    return isFast(s) && s.reachable && (s.arrive == null || s.arrive >= SAFE_ARRIVE_SOC) && k !== 'full' && k !== 'out' && onRoute(s);
  });
  const pref = suitable.filter(brandOk);
  const fast = pref.length ? pref : suitable;
  if (!fast.length) return { station: null, kind: 'none', fast: [] };

  const priced = fast.map((s, rank) => ({ s, rank, info: priceInfo(s) })).filter((x) => x.info?.comparable);
  const currency = mainCurrency(priced);
  const same = priced.filter((x) => x.info.currency === currency).sort((a, b) => a.info.value - b.info.value || a.rank - b.rank);
  if (same.length < 2) return { station: fast[0], kind: 'nearestFast', fast };

  const cheapFirst = same.map((x) => x.s);
  const rest = fast.filter((s) => !cheapFirst.includes(s));
  return { station: cheapFirst[0], kind: rest.length ? 'cheapestKnown' : 'cheapest', fast: [...cheapFirst, ...rest] };
}

/** Panel başlığı (soc: yuvarlanmış pil yüzdesi). Şablonlar çeviri anahtarıdır. */
export const PICK_TITLES = {
  cheapest: 'Pil %{0} — en ucuz hızlı şarj (150 kW üstü):',
  cheapestKnown: 'Pil %{0} — fiyatı bilinenler içinde en ucuz (150 kW üstü):',
  nearestFast: 'Pil %{0} — en yakın hızlı şarj (150 kW üstü):',
  none: 'Pil %{0} — uygun 150 kW üstü yok, en yakın:',
};
