// Google Places istasyon listesi: sunucu kısaltması ve istemci adayı, sahte yanıtlarla (anahtar/ağ yok). Kullanım: node scripts/test-google-stations.mjs
import { compact, googleStationsNear, MAX_RESULTS } from '../server/googleStations.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const loc = (la = 39.9, lo = 32.8) => ({ latitude: la, longitude: lo });
const place = (extra = {}) => ({ id: 'P1', displayName: { text: 'ZES Test' }, location: loc(), ...extra });

// --- compact
ok('konumsuz kayıt elenir', compact({ id: 'x', displayName: { text: 'a' } }) === null);
ok('kimliksiz kayıt elenir', compact({ location: loc() }) === null);
ok('kalıcı kapalı elenir', compact(place({ businessStatus: 'CLOSED_PERMANENTLY' })) === null);
ok('yalnızca Tesla elenir', compact(place({ evChargeOptions: { connectorAggregation: [{ type: 'EV_CONNECTOR_TYPE_TESLA', maxChargeRateKw: 250 }] } })) === null);
{
  const c = compact(place({ evChargeOptions: { connectorAggregation: [
    { type: 'EV_CONNECTOR_TYPE_CCS_COMBO_2', maxChargeRateKw: 120 },
    { type: 'EV_CONNECTOR_TYPE_CHADEMO', maxChargeRateKw: 50 },
    { type: 'EV_CONNECTOR_TYPE_TYPE_2', maxChargeRateKw: 22 },
    { type: 'EV_CONNECTOR_TYPE_TESLA', maxChargeRateKw: 250 },
  ] } }));
  ok('DC en yüksek kW, AC ayrı, Tesla bağlayıcısı sayılmaz', c.dc === 120 && c.ac === 22 && c.k === 1 && c.n === 'ZES Test');
}
ok('bağlayıcı türü belirsiz ama ≥40 kW → DC', compact(place({ evChargeOptions: { connectorAggregation: [{ type: 'EV_CONNECTOR_TYPE_OTHER', maxChargeRateKw: 60 }] } })).dc === 60);
ok('J1772 60 kW bile olsa AC', compact(place({ evChargeOptions: { connectorAggregation: [{ type: 'EV_CONNECTOR_TYPE_J1772', maxChargeRateKw: 7 }] } })).dc === null);
ok('bağlayıcı bilgisi yoksa k=0, güç null', (() => { const c = compact(place()); return c.k === 0 && c.dc === null && c.ac === null; })());

// --- googleStationsNear
const mk = (status, body) => {
  const calls = [];
  const fetchImpl = async (u, init) => { calls.push({ u, init }); return { ok: status < 400, status, json: async () => body }; };
  return { fetchImpl, calls };
};
{
  const { fetchImpl, calls } = mk(200, { places: [place(), place({ id: 'P2', location: undefined })] });
  const r = await googleStationsNear('TEST-KEY-NOT-REAL', { lat: 39.9, lon: 32.8, r: 20000 }, { fetchImpl });
  const body = JSON.parse(calls[0].init.body);
  ok('searchNearby: tür, 20 sonuç sınırı, daire yarıçapı', body.includedTypes[0] === 'electric_vehicle_charging_station' && body.maxResultCount === MAX_RESULTS && body.locationRestriction.circle.radius === 20000);
  ok('anahtar yalnızca başlıkta, URL ve gövdede değil', calls[0].init.headers['X-Goog-Api-Key'] === 'TEST-KEY-NOT-REAL' && !calls[0].u.includes('TEST-KEY') && !calls[0].init.body.includes('TEST-KEY'));
  ok('alan maskesi evChargeOptions içerir, 20 dolmadıkça full=false, konumsuz elenir', /evChargeOptions/.test(calls[0].init.headers['X-Goog-FieldMask']) && r.items.length === 1 && r.full === false);
}
{
  const many = Array.from({ length: MAX_RESULTS }, (_, i) => place({ id: 'P' + i, location: loc(39.9 + i * 0.001) }));
  const { fetchImpl } = mk(200, { places: many });
  ok('20 kayıt dolunca full=true (istemci böler)', (await googleStationsNear('k', { lat: 39.9, lon: 32.8, r: 20000 }, { fetchImpl })).full === true);
}
{
  const { fetchImpl } = mk(403, {});
  let err = null;
  try { await googleStationsNear('k', { lat: 1, lon: 1, r: 1000 }, { fetchImpl }); } catch (e) { err = e; }
  ok('HTTP hatasında status taşıyan hata, gövde yok', err?.status === 403 && err.message === 'Google HTTP 403');
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
