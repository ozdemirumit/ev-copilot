// js/nav/aheadEvents.js: rota konumuna bağlı yol önü olayları (trafik/yağış) — kalan mesafe konumla güncellenir (v0.99.56).
// Belirlenimci: ağ yok, saat parametre.
import {
  anchorTraffic, anchorRain, mergeEvent, eventState, stabilize, stepEvent, dueThreshold, primeThresholds,
  fmtTrafficKm, fmtRainKm, TRAFFIC_STALE_MS, RAIN_STALE_MS,
} from '../js/nav/aheadEvents.js';

let pass = 0, fail = 0;
const ok = (n, c, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', n, info); } };
const T0 = 1_700_000_000_000;
const ctx = (km, extra = {}) => ({ km, offRouteKm: 0, planId: 'P', now: T0 + 60e3, ...extra });
const tr = (o = {}) => anchorTraffic({ jam: { from: 3, to: 4, jam: true }, fetchKm: 20, sameRoad: true, onRoute: true, delayMin: 0, planId: 'P', at: T0, ...o });

// 3 km sonra trafik → 1 / 2,5 / 3 km yol
{
  const ev = tr();
  ok('olay plan km 23\'e bağlanır', ev.anchored && ev.alongKm === 23 && ev.lenKm === 1);
  ok('başta ~3.0 km', stepEvent(ev, ctx(20)).text.startsWith('🚦 ~3.0 km ileride yoğun trafik (1.0 km)'));
  ok('1 km sonra ~2.0 km', stepEvent(ev, ctx(21)).text.startsWith('🚦 ~2.0 km ileride'));
  ok('2,5 km sonra ~0.5 km', stepEvent(ev, ctx(22.5)).text.startsWith('🚦 ~0.5 km ileride'));
  const at3 = stepEvent(ev, ctx(23));
  ok('3 km sonra Şu an (içinde)', at3.st.status === 'inside' && at3.text.startsWith('🚦 Şu an yoğun trafik'));
  ok('sıkışıklık içinde de Şu an', stepEvent(ev, ctx(23.9)).st.status === 'inside');
  const past = stepEvent(ev, ctx(24.3));
  ok('sonu geçilince olay biter, metin yok', past.drop && past.text === null);
  ok('kalan mesafe hiçbir zaman eksi değil', eventState(tr(), ctx(23.05)).remainKm === 0);
  ok('≥10 km tam sayı', fmtTrafficKm(12.4) === '12' && fmtTrafficKm(9.96) === '10.0');
}

// GPS sıçraması
{
  ok('küçük geri sıçrama (0,2 km) önceki değeri korur', stabilize(1.5, 1.7) === 1.5);
  ok('büyük artış (geri dönüş) kabul edilir', stabilize(1.5, 2.5) === 2.5);
  ok('azalma her zaman kabul', stabilize(1.5, 1.2) === 1.2);
  const ev = tr();
  stepEvent(ev, ctx(21));
  ok('olayda geri sıçrama: ~2.0 km kalır', stepEvent(ev, ctx(20.85)).text.startsWith('🚦 ~2.0 km'));
}

// Güvenilmez konum: geri sayım yok
{
  const nr = tr({ sameRoad: false });
  ok('farklı yol: anchored=false, mesafe belirsiz', !nr.anchored && /mesafe belirsiz/.test(stepEvent(nr, ctx(21)).text) && !/~\d/.test(stepEvent(nr, ctx(21)).text));
  const off = tr({ onRoute: false });
  ok('alınırken rota dışı: anchored=false', !off.anchored && off.alongKm === null);
  const ev = tr();
  ok('sürüşte rota dışı: unknown', stepEvent(ev, ctx(21, { offRouteKm: 1.5 })).st.status === 'unknown');
  ok('konum km yok: unknown', stepEvent(ev, ctx(null)).st.status === 'unknown');
  ok('rota dışından dönünce geri sayım', stepEvent(ev, ctx(21.5)).text.startsWith('🚦 ~1.5 km'));
}

// Eskime ve yeniden rota
{
  const ev = tr({ delayMin: 12 });
  const st = stepEvent(ev, ctx(21, { now: T0 + TRAFFIC_STALE_MS + 1 }));
  ok('eski trafik: sıkışıklık metni yok, büyük gecikme kalır', st.drop && st.text === '🚦 Rotada trafik kaynaklı ≈ 12 dk gecikme var');
  const rr = stepEvent(tr(), ctx(21, { planId: 'Q' }));
  ok('yeniden rota (başka plan): metin yok, olay biter', rr.drop && rr.text === null);
}

// Aynı sıkışıklık yeniden alınınca: eşikler ve gösterilen km korunur, ilk duyuru tekrarlanmaz
{
  const a = tr();
  primeThresholds(a, 3);
  ok('alınırken 3 km: 5 km eşiği söylenmiş sayılır', a.said.includes(5) && !a.said.includes(2));
  const b = mergeEvent(a, tr({ jam: { from: 1.6, to: 2.6, jam: true }, fetchKm: 21.4, at: T0 + 600e3 }));
  ok('aynı yer (±1 km) birleşir', b.known === true && b.said.includes(5) && b.alongKm === 23);
  const c = mergeEvent(a, tr({ jam: { from: 10, to: 11, jam: true } }));
  ok('farklı yer yeni olay', !c.known && c.said.length === 0);
  ok('başka plan birleşmez', !mergeEvent(a, tr({ planId: 'Q' })).known);
}

// Sesli eşikler: her eşik bir kez, art arda yığılma yok
{
  const ev = tr({ jam: { from: 8, to: 9, jam: true } });
  primeThresholds(ev, 8);
  ok('8 km: eşik yok', dueThreshold(ev, 8) === null);
  ok('4,9 km: 5 km eşiği', dueThreshold(ev, 4.9) === 5);
  ok('4,8 km: tekrar yok', dueThreshold(ev, 4.8) === null);
  ok('0,4 km\'ye atlama: yalnız en küçük eşik, 2 km de söylenmiş sayılır', dueThreshold(ev, 0.4) === 0.5 && ev.said.includes(2));
  ok('sonra hiçbir eşik kalmaz', dueThreshold(ev, 0.1) === null);
  ok('km bilinmiyorsa ses yok', dueThreshold(tr(), null) === null);
}

// Yağış: alan düzeyinde, kaba mesafe; kesin başlangıç noktası iddiası yok
{
  const r = anchorRain({ d: 25, fetchKm: 20, mm: 1.24, temp: 1.6, planId: 'P', at: T0 });
  ok('örnek noktası plan km 45', r.anchored && r.alongKm === 45);
  ok('başta ~25 km (5 km adım)', stepEvent(r, ctx(20)).text === '🌧️ İleride yağmur: ~25 km sonra (1.2 mm/sa, 2°C, buzlanma riski)');
  ok('3 km sonra ~20 km (22 → 5 katı)', stepEvent(r, ctx(23)).text.startsWith('🌧️ İleride yağmur: ~20 km sonra'));
  ok('10 km altı tam sayı', stepEvent(r, ctx(38.4)).text.startsWith('🌧️ İleride yağmur: ~7 km sonra'));
  ok('noktaya varınca "bu bölgede" (geri sayım değil)', stepEvent(r, ctx(44.5)).text.startsWith('🌧️ Bu bölgede yağmur bekleniyor'));
  ok('noktayı 10 km geçince biter', stepEvent(r, ctx(55.1)).drop);
  ok('rota dışında mesafe belirsiz', /mesafe belirsiz/.test(stepEvent(r, ctx(30, { offRouteKm: 3 })).text));
  ok('yağış eskir', stepEvent(r, ctx(30, { now: T0 + RAIN_STALE_MS + 1 })).drop);
  ok('fmtRainKm en az 1', fmtRainKm(0.2) === '1' && fmtRainKm(12.4) === '10');
}

// Trafik + yağış aynı anda, tek konum akışı
{
  const t = tr();
  const r = anchorRain({ d: 10, fetchKm: 20, mm: 0.5, temp: 12, planId: 'P', at: T0 });
  const seq = [20, 21, 22.5, 23, 25, 30].map((km) => [stepEvent(t, ctx(km)).text, stepEvent(r, ctx(km)).text]);
  ok('trafik ve yağış birlikte azalır', seq[0][0].startsWith('🚦 ~3.0') && seq[0][1].includes('~10 km') && seq[1][0].startsWith('🚦 ~2.0') && seq[1][1].includes('~9 km'));
  ok('trafik geçilince yağış sürer', seq[4][0] === null && seq[4][1].includes('~5 km'));
  ok('yağış noktasında bölge metni', seq[5][1].startsWith('🌧️ Bu bölgede'));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
