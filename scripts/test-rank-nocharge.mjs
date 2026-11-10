// Aday istasyon sıralaması: varış pili hedefte/üstündeyse şarj gerekmez (süre/maliyet 0, sona); şarj gerektirenlerde eksi maliyet yok.
// Şarj oturumu makullük denetimi (imkânsız ortalama güç kayda alınmaz). Kullanım: node scripts/test-rank-nocharge.mjs
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const { rankStations } = await import('../js/routing/planner.js');
const { plausibleCharge, avgKw } = await import('../js/physics/chargeSanity.js');
const { VEHICLE } = await import('../js/config.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

const BAT = VEHICLE.batteryNetKwh;
const profile = { energyBetween: (a, b, k = 1) => Math.max(0, b - a) * 0.2 * k }; // 20 kWh/100 km
const st = (id, km, extra = {}) => ({ id, name: id, km, kw: 180, price: 14, opId: 'astor', slow: false, uncertain: false, offKm: 0.2, ...extra });
const stations = [st('yakin', 6), st('orta', 150), st('uzak', 300)];
const rows = rankStations({ profile, stations, startKm: 0, startSoc: 99, k: 1, mode: 'cheap' });
const by = (id) => rows.find((r) => r.station.id === id);

ok('yakın istasyonda şarj gerekmez işareti', by('yakin')?.noCharge === true, JSON.stringify(by('yakin')));
ok('şarj gerekmeyende maliyet ve süre 0', by('yakin').cost === 0 && by('yakin').minutes === 0);
ok('şarj gerekmeyende hedef varışı aşmaz', by('yakin').to === by('yakin').arrive);
ok('hiçbir satırda eksi maliyet/süre yok', rows.every((r) => r.cost >= 0 && r.minutes >= 0 && r.to >= r.arrive));
ok('şarj gerekenler önce, gerekmeyen sonda', rows.at(-1).noCharge === true && rows.slice(0, -1).every((r) => !r.noCharge));
ok('şarj gerektirende hedef ≥ varış', by('uzak') && !by('uzak').noCharge && by('uzak').to > by('uzak').arrive && by('uzak').cost > 0);
const low = rankStations({ profile, stations: [st('a', 100)], startKm: 0, startSoc: 40, k: 1, mode: 'cheap' })[0];
ok('düşük pilde şarj gerekir ve maliyet pozitif', !low.noCharge && low.cost > 0 && low.minutes > 0);
ok('maliyet formülü: puan × kapasite ÷ 0,95 × fiyat', Math.abs(low.cost - (((low.to - low.arrive) / 100) * BAT / 0.95) * 14) < 0.01);

// Şarj oturumu makullüğü
const max = VEHICLE.maxDcKw;
ok('ekrandaki imkânsız kayıt reddedilir (%4→%42, 5 dk)', !plausibleCharge({ kwh: 33.6, min: 5, maxKw: 180 }));
ok('ortalama güç hesabı', Math.round(avgKw(33.6, 5)) === 403);
ok('gerçekçi oturum kabul (%10→%80, 28 dk)', plausibleCharge({ kwh: 62, min: 28, maxKw: 180 }));
ok('sınırdaki oturum (180 kW) kabul', plausibleCharge({ kwh: 30, min: 10, maxKw: 180 }));
ok('süre 0 reddedilir', !plausibleCharge({ kwh: 10, min: 0, maxKw: 180 }));
ok('araç sınırı bilinmiyorsa denetlenmez', plausibleCharge({ kwh: 30, min: 5, maxKw: undefined }));
ok('seçili aracın DC sınırı tanımlı', typeof max === 'number' && max > 0, String(max));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
