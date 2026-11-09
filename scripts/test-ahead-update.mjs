// Yolda rota önü verisi: trafik özeti (nav/aheadTraffic.js) ve profil tazeleme hesabı (routing/aheadUpdate.js)
import { jamFromSpans, aheadFromRoute } from '../js/nav/aheadTraffic.js';
import { mergeSpeeds, mergeWx, wxQueryKms } from '../js/routing/aheadUpdate.js';
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log('BAŞARISIZ:', n); } };

// ---- jamFromSpans
t('boş', jamFromSpans([]) === null && jamFromSpans(null) === null);
t('kısa yavaş (<3 km) önemsiz', jamFromSpans([{ from: 5, to: 7, lvl: 'moderate' }]) === null);
t('uzun yavaş (≥3 km) önemli', jamFromSpans([{ from: 5, to: 8.5, lvl: 'moderate' }])?.jam === false);
t('sıkışık 0,6 km önemli', jamFromSpans([{ from: 10, to: 10.6, lvl: 'heavy' }])?.jam === true);
t('bitişik kesimler birleşir', (() => { const j = jamFromSpans([{ from: 5, to: 6, lvl: 'moderate' }, { from: 6.2, to: 7.2, lvl: 'severe' }]); return j && j.from === 5 && j.to === 7.2 && j.jam === true; })());
t('150 km ötesi sayılmaz', jamFromSpans([{ from: 200, to: 205, lvl: 'heavy' }]) === null);
t('ilk önemli küme seçilir', jamFromSpans([{ from: 1, to: 1.3, lvl: 'heavy' }, { from: 20, to: 25, lvl: 'heavy' }])?.from === 20);
t('bilinmeyen seviye yok sayılır', jamFromSpans([{ from: 1, to: 9, lvl: 'free' }]) === null);

// ---- aheadFromRoute
const a = aheadFromRoute({ durationH: 2, trafficRatio: 1.25, trafficSpans: [{ from: 3, to: 5, lvl: 'heavy' }] });
t('gecikme dakikası', a.delayMin === 24);
t('kalan süre ve jam', a.remainH === 2 && a.jam?.from === 3);
t('trafik yok → gecikme 0', aheadFromRoute({ durationH: 1, trafficRatio: 1, trafficSpans: [] }).delayMin === 0);
t('rota boş → güvenli', aheadFromRoute(null).delayMin === 0);

// ---- wxQueryKms / mergeWx
t('hava km listesi', JSON.stringify(wxQueryKms(200, 30)) === '[30,50,100,150,200]');
t('hava km: varışa yakın', JSON.stringify(wxQueryKms(60, 55)) === '[55,60]');
t('hava km: varıştaysa yalnız konum', JSON.stringify(wxQueryKms(60, 59.5)) === '[59.5]');
const mw = mergeWx([{ km: 0, temp: 1 }, { km: 50, temp: 2 }, { km: 100, temp: 3 }], 60, [{ km: 60, temp: 9 }, { km: 100, temp: 8 }]);
t('geride kalan korunur, ilerisi değişir', mw.length === 4 && mw[1].temp === 2 && mw[2].temp === 9 && mw[3].temp === 8);
t('eski hava yoksa', mergeWx(undefined, 10, [{ km: 10 }]).length === 1);

// ---- mergeSpeeds
const pts = Array.from({ length: 51 }, (_, i) => ({ km: i * 2, lat: 40 + i * 0.01, lon: 30 }));
const speeds = Array.from({ length: 50 }, () => ({ vFree: 100, tf: 1 }));
const rt = { distanceKm: 60, intervals: [], steps: [{ distM: 30000, staticSec: 1800 }, { distM: 30000, staticSec: 1080 }, { distM: 0 }] };
const m = mergeSpeeds({ pts, speeds, km: 40, rt });
t('sonuç var, uzunluk aynı', m && m.speeds.length === speeds.length);
t('geçilen dilimler aynen', m.speeds.slice(0, 20).every((s, i) => s === speeds[i]));
t('önce yavaş kesim ~60', Math.abs(m.speeds[20].vFree - 60) < 1 && Math.abs(m.speeds[34].vFree - 60) < 1);
t('sonra ~100', Math.abs(m.speeds[36].vFree - 100) < 1 && Math.abs(m.speeds[49].vFree - 100) < 1);
t('ara konumda da çalışır (km 41)', mergeSpeeds({ pts, speeds, km: 41, rt: { ...rt, distanceKm: 59 } })?.speeds.length === 50);
t('uzunluk çok farklı → uygulanmaz', mergeSpeeds({ pts, speeds, km: 40, rt: { ...rt, distanceKm: 90 } }) === null);
t('süre bilgisi yok → uygulanmaz', mergeSpeeds({ pts, speeds, km: 40, rt: { ...rt, steps: [{ distM: 60000 }] } }) === null);
t('varışa <3 km → uygulanmaz', mergeSpeeds({ pts, speeds, km: 98, rt }) === null);
t('rota yok / hız dizisi yok', mergeSpeeds({ pts, speeds, km: 40, rt: null }) === null && mergeSpeeds({ pts, speeds: null, km: 40, rt }) === null);
t('girdi değişmez', speeds.every((s) => s.vFree === 100));

console.log(`${ok} geçti, ${bad} kaldı`);
process.exit(bad ? 1 : 0);
