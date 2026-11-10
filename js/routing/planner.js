import { VEHICLE, PLANNER as P } from '../config.js';
import { chargeMinutes } from './chargeCurve.js';
import { slotKind, isFresh } from './slots.js';
import { t } from '../i18n/index.js';

const BAT = VEHICLE.batteryNetKwh;

/** Mod başına maliyet fonksiyonu (düşük = iyi). minutes: şarj + fiş + sapma, cost: TL. */
export function metric(mode, minutes, cost) {
  if (mode === 'fast') return minutes;
  if (mode === 'cheap') return cost + minutes * 0.001; // eşitlikte hızlı olanı seç
  return cost + minutes * P.timeValueTlPerMin; // optimum
}

/** Planlanabilir istasyon: hızlı DC (≥ minKw) veya yedek olarak izin verilmişse yavaş AC/belirsiz. */
export const meetsPower = (s) => s.kw >= P.minKw || (P.allowSlow && s.slow && P.minKw <= P.baseKw); // güç filtresi (40+ dışında) açıkken yavaş yedek aday olmaz
export const brandOk = (s) => !P.brands?.length || P.brands.includes(s.opId); // tercih edilen marka (boş = hepsi). Tercih yumuşaktır: tercih dışı marka yalnızca gerektiğinde kullanılır
const PREF_PENALTY = 1e5; // tercih dışı her durak için ceza (hızlı modda dk, öbürlerinde TL): önce tercih dışı durak sayısı en aza iner, sonra mod ölçütü
const offPref = (s) => (brandOk(s) ? 0 : PREF_PENALTY);
/** Haritada gösterilecek istasyon: güç filtresi (AC = hepsi) ve marka tercihi (plandaki duraklar tercih dışı olsa da çizilir). */
export const shown = (s, planned) => (P.minKw <= P.baseKw || meetsPower(s)) && (brandOk(s) || !!planned?.has(s.id));
export const usable = (s) => meetsPower(s) && !(isFresh(s) && slotKind(s) === 'out'); // tamamen arızalı (taze bilgi) istasyon aday olmaz

/**
 * Hızlı DC istasyon bulunmayan uzun rota aralıkları (km). Veri eksikliğini (özellikle açık kaynak istasyon kaydının seyrek olduğu bölgeler)
 * kullanıcıya göstermek için; yalnızca `minGapKm`'den uzun boşluklar döner.
 */
export function stationGaps(stations, totalKm, minGapKm = 150) {
  const km = stations.filter((s) => s.kw >= P.minKw).map((s) => s.km).sort((a, b) => a - b);
  const pts = [0, ...km, totalKm];
  const gaps = [];
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > minGapKm) gaps.push({ from: pts[i - 1], to: pts[i] });
  return gaps;
}

const WAIT_MIN = 20; // taze bilgiye göre tüm yuvalar doluysa tahmini bekleme (yalnızca yakın gelecekteki duraklar)
const WAIT_NEAR_KM = 150; // doluluk bilgisi uzak duraklar için güvenilmez: ilk 150 km
const detourKwh = (s) => s.offKm * 2 * P.detourKwhPerKm;
const waitMin = (s, fromKm) => (isFresh(s) && slotKind(s) === 'full' && s.km - fromKm <= WAIT_NEAR_KM ? WAIT_MIN : 0);
const detourMin = (s) => ((s.offKm * 2) / P.detourKmh) * 60;

/**
 * Çok duraklı şarj planı (dinamik programlama). Düğümler: başlangıç, istasyonlar (rota sırasıyla), varış.
 * Durum: (istasyon, şarjdan ayrılış SoC'si ∈ {20,25,…,90}). Kenar: rota enerjisi (k ile ölçekli) + sapma enerjisi.
 *  - ara istasyona varış SoC ≥ chargerMinArrival, varışa varış SoC ≥ minArrival
 *  - maxFirstStopKm: dinamik fallback'te ilk durağın bu km'den ileride olmasını yasaklar.
 *  - forceFirstId: ilk durak bu istasyon olmak zorundadır (kullanıcı "Git" ile seçti).
 *  - mustIds: bu istasyonların hepsi plana girmek zorundadır (kullanıcı bir durağı başka istasyonla değiştirdi); excludeIds: bu istasyonlar kullanılmaz.
 */
export function planRoute(args) {
  const attempt = (a) => {
    const strict = solve(a, P.minStopAdd);
    // Çok kısıtlı rotada (az/uzak istasyon) "en az ekleme" kuralı çözümü engelliyorsa kuralsız yeniden dene.
    return strict.feasible || !P.minStopAdd ? strict : solve(a, 0);
  };
  // Önce yakındaki, taze bilgiye göre DOLU istasyonlar hiç kullanılmadan planla (dolu durağa gitmek yerine başka istasyon seçilsin);
  // başka uygun zincir yoksa dolu olanlar (bekleme süresiyle) yeniden aday olur.
  const noFull = attempt({ ...args, skipFull: true });
  return noFull.feasible ? noFull : attempt(args);
}

/** Eşik altına düşme cezası: puan başına ≈ 7 dk veya 20 TL (hızlı modda 3 dk). */
const dipPenalty = (mode, pts) => Math.max(0, pts) * (mode === 'fast' ? 3 : 20);

function solve({ profile, stations, startKm = 0, startSoc, minArrival, mode = 'opt', k = 1, maxFirstStopKm = Infinity, forceFirstId = null, skipFull = false, mustIds = null, excludeIds = null }, minAdd) {
  const tol = P.tolerance;
  const endKm = profile.totalKm;
  const must = new Set(mustIds || []);
  const ban = new Set(excludeIds || []);
  const fullNear = (s) => skipFull && s.id !== forceFirstId && !must.has(s.id) && isFresh(s) && slotKind(s) === 'full' && s.km - startKm <= WAIT_NEAR_KM; // yakın ve taze bilgiye göre dolu
  // Zorunlu durak (kullanıcının seçtiği) güç filtresine/marka tercihine takılmaz: elle seçilen istasyon her zaman aday olur
  const cands = stations.filter((s) => s.km > startKm + 0.5 && s.km < endKm - 0.5 && (usable(s) || must.has(s.id)) && !fullNear(s) && !ban.has(s.id)).sort((a, b) => a.km - b.km);
  // Zorunlu duraklar: düğüm n = cands[n-1]. mustPre[i] = cands[0..i-1] içindeki zorunlu sayısı; bir kenar zorunlu durağı atlayamaz.
  const mustPre = [0];
  cands.forEach((s) => mustPre.push(mustPre[mustPre.length - 1] + (must.has(s.id) ? 1 : 0)));
  const mustTotal = mustPre[cands.length];
  const mustBetween = (n, j) => mustPre[j - 1] - mustPre[n]; // n ile j arasında (ikisi hariç) atlanan zorunlu durak sayısı
  const levels = [];
  for (let l = P.minChargeTo; l <= P.maxChargeTo; l += P.chargeStep) levels.push(l);

  // states[0] = başlangıç (tek durum), states[i] = i. istasyon × ayrılış seviyeleri
  const states = [[{ leave: startSoc, metric: 0, prev: null }], ...cands.map(() => levels.map(() => null))];
  const nodeKm = [startKm, ...cands.map((s) => s.km)];
  let best = null;

  for (let n = 0; n < states.length; n++) {
    for (let si = 0; si < states[n].length; si++) {
      const st = states[n][si];
      if (!st) continue;
      const fromKm = nodeKm[n];

      const arriveEnd = st.leave - (profile.energyBetween(fromKm, endKm, k) / BAT) * 100;
      if (arriveEnd >= minArrival - tol && !(n === 0 && forceFirstId) && mustTotal - mustPre[n] === 0) { // zorunlu durak varsa atlanamaz; sonrasında zorunlu durak kalmamalı
        const total = st.metric + dipPenalty(mode, minArrival - arriveEnd);
        if (!best || total < best.metric) best = { metric: total, from: [n, si], arriveEnd };
      }

      for (let j = n + 1; j < states.length; j++) {
        const s = cands[j - 1];
        if (mustBetween(n, j) > 0) break; // araya giren zorunlu durak atlanamaz (daha ilerisi de geçersiz)
        if (n === 0 && s.km > maxFirstStopKm) break;
        if (n === 0 && forceFirstId && s.id !== forceFirstId) continue; // ilk durak seçilen istasyon olmalı
        const eRoute = profile.energyBetween(fromKm, s.km, k);
        if (st.leave - (eRoute / BAT) * 100 < P.chargerMinArrival - tol) break; // daha ilerisi daha da zor
        const arrive = st.leave - ((eRoute + detourKwh(s) * k) / BAT) * 100;
        if (arrive < P.chargerMinArrival - tol) continue;
        const dip = dipPenalty(mode, P.chargerMinArrival - arrive);

        levels.forEach((L, li) => {
          if (L < arrive + Math.max(3, minAdd)) return;
          const mins = chargeMinutes(s.kw, arrive, L);
          const cost = (((L - arrive) / 100) * BAT / P.billedEff) * s.price;
          const m = st.metric + dip + offPref(s) + metric(mode, mins + P.stopOverheadMin + detourMin(s) + waitMin(s, startKm), cost);
          if (!states[j][li] || m < states[j][li].metric) {
            states[j][li] = { leave: L, metric: m, prev: [n, si], arrive, mins, cost };
          }
        });
      }
    }
  }

  if (!best) {
    const need = (profile.energyBetween(startKm, endKm, k) / BAT) * 100;
    return { feasible: false, reason: explainBreak({ profile, cands, states, nodeKm, startKm, endKm, startSoc, k, need }), stops: [] };
  }

  // Geriye doğru izle
  const stops = [];
  let ref = best.from;
  while (ref && ref[0] > 0) {
    const [n, si] = ref;
    const st = states[n][si];
    const s = cands[n - 1];
    stops.unshift({
      station: s, km: s.km, arriveSoc: st.arrive, leaveSoc: st.leave,
      minutes: st.mins, overheadMin: P.stopOverheadMin + detourMin(s) + waitMin(s, startKm), cost: st.cost,
      kwhAdded: ((st.leave - st.arrive) / 100) * BAT,
    });
    ref = st.prev;
  }

  const driveMin = profile.timeBetween(startKm, endKm) * 60 + stops.reduce((a, s) => a + detourMin(s.station), 0);
  const chargeMin = stops.reduce((a, s) => a + s.minutes + P.stopOverheadMin + waitMin(s.station, startKm), 0); // doluysa bekleme dahil
  return {
    feasible: true, mode, startKm, stops,
    totals: {
      driveMin, chargeMin, totalMin: driveMin + chargeMin,
      cost: stops.reduce((a, s) => a + s.cost, 0),
      arriveSoc: best.arriveEnd,
    },
  };
}

/**
 * Zincir neden kurulamadı? Ulaşılabilen en uzak istasyonu ve oradan sonraki boşluğu bulup açıklar
 * (genelde iki aday arası, tam şarjla gidilebilecek mesafeden uzundur: veri eksikliği veya çok uzun rota).
 */
function explainBreak({ profile, cands, states, nodeKm, startKm, endKm, startSoc, k, need }) {
  let last = 0;
  for (let n = 1; n < states.length; n++) if (states[n].some(Boolean)) last = n;
  const fromKm = nodeKm[last];
  const leave = last === 0 ? startSoc : P.maxChargeTo;
  // fromKm'den `leave` pille eşik (giriş pili - tolerans) altına düşmeden gidilebilecek en uzak km (ikili arama)
  let lo = fromKm;
  let hi = endKm;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (leave - (profile.energyBetween(fromKm, mid, k) / BAT) * 100 >= P.chargerMinArrival - P.tolerance) lo = mid; else hi = mid;
  }
  const reach = Math.max(0, lo - fromKm);
  const nextKm = cands[last]?.km ?? endKm;
  const where = last === 0 ? t('başlangıç') : t("{0}. km'deki {1} istasyonu", fromKm.toFixed(0), cands[last - 1].name);
  const next = cands[last] ? t("sonraki aday istasyon {0}. km'de ({1} km)", nextKm.toFixed(0), (nextKm - fromKm).toFixed(0)) : t('varışa {0} km var', (endKm - fromKm).toFixed(0));
  return t('Uygun şarj zinciri bulunamadı: {0} sonrası: {1}; ama %{2} pille en fazla ~{3} km gidilebilir.', where, next, Math.round(leave), reach.toFixed(0)) + ' '
    + t('Bu aralıkta haritada istasyon eksik olabilir: İstasyon sekmesindeki "Kendi istasyonlarım"a bildiğin istasyonları ekle; ayrıca tüketimi, giriş pilini veya şarj hedefini gözden geçir (toplam tüketim ≈ %{0} pil, {1} aday istasyon).', need.toFixed(0), cands.length);
}

/**
 * Bir şarj durağının yerine konabilecek istasyonlar: rotada durağın ±rangeKm (km) çevresindekiler, FİLTRESİZ (güç filtresi ve marka tercihi uygulanmaz;
 * filtreye uymayanlar offFilter ile işaretlenir). Durağın kendisi, plandaki öbür duraklar ve araçtan (fromKm) geride kalanlar hariç.
 * Rotada durağa en yakın olan önce. stop: { station, km }; stations: plan.stations (km = rotadaki konum).
 */
export function swapCandidates({ stop, stations, rangeKm = 5, fromKm = 0, plannedIds = [] }) {
  const taken = new Set(plannedIds);
  taken.delete(stop.station.id);
  const at = stop.km ?? stop.station.km;
  return stations
    .filter((s) => s.id !== stop.station.id && !taken.has(s.id) && s.km > fromKm + 0.5 && Math.abs(s.km - at) <= rangeKm)
    .map((s) => ({ station: s, dKm: s.km - at, offFilter: !(usable(s) && brandOk(s)) }))
    .sort((x, y) => Math.abs(x.dKm) - Math.abs(y.dKm));
}

/**
 * İstasyon sıralaması (tek istasyon bakışıyla): başlangıçtan ek şarj olmadan varış SoC'si ve %80'e şarj süresi/maliyeti.
 * Erişilemeyenler (varış < chargerMinArrival) elenir.
 */
const NO_CHARGE_SCORE = 1e9; // şarj gerekmeyen adaylar listenin sonunda (yakın olan önce)
export function rankStations({ profile, stations, startKm = 0, startSoc, k = 1, mode = 'opt', target = 80 }) {
  const rows = [];
  for (const s of stations) {
    if (s.km <= startKm + 0.5 || !usable(s)) continue;
    const arrive = startSoc - ((profile.energyBetween(startKm, s.km, k) + detourKwh(s) * k) / BAT) * 100;
    if (arrive < P.chargerMinArrival) continue;
    const goal = Math.min(P.maxChargeTo, Math.max(target, arrive + 10));
    // Varış pili zaten hedefte ya da üstündeyse şarj gerekmez: süre/maliyet 0, sıralamada sona (eksi maliyet "en ucuz" görünmesin)
    const noCharge = arrive >= goal - 1;
    const to = noCharge ? arrive : goal;
    const minutes = noCharge ? 0 : chargeMinutes(s.kw, arrive, to) + P.stopOverheadMin + detourMin(s);
    const cost = noCharge ? 0 : (((to - arrive) / 100) * BAT / P.billedEff) * s.price;
    rows.push({ station: s, arrive, to, minutes, cost, noCharge, score: noCharge ? NO_CHARGE_SCORE + s.km : metric(mode, minutes, cost) + offPref(s) }); // tercih edilen markalar listede önce
  }
  return rows.sort((a, b) => a.score - b.score);
}
