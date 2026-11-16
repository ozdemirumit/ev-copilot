// BL-P2-09 aşama 1: js/routing/occupancyLabel.js saf doluluk biçimlendiricisi — çevrimdışı, sentetik veri. node scripts/test-occupancy-label.mjs
// Fikstürler server/availability.mjs buildAvailability ile üretilir (ağ yok, anahtar yok, sağlayıcı çağrısı yok).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { formatOccupancy, occupancyText, OCC_TEMPLATES, OCC_SOURCES } = await import(pathToFileURL(join(root, 'js/routing/occupancyLabel.js')).href);
const { buildAvailability } = await import(pathToFileURL(join(root, 'server/availability.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const NOW = 1_800_000_000_000;
const MIN = 60e3;
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const av = (o) => deepFreeze(buildAvailability({ fetchedAt: NOW, now: NOW, ...o }));
const fmt = (a, now = NOW) => formatOccupancy(a, { now });
const NOT_SHOWN = (d) => d.state === 'unknown' && d.confirmed === false && d.available === null && d.total === null && d.tone === 'muted';
const txt = (d) => occupancyText(d);
const noStatusWords = (s) => !/boş|dolu \(|arızalı|canlı/.test(s);

// ---------- 1) Taze, sağlayıcı zamanlı: canlı teyit ----------
{
  const d = fmt(av({ source: 'here', evses: [{ status: 'AVAILABLE', at: NOW - 3 * MIN }, { status: 'CHARGING', at: NOW - 5 * MIN }] }));
  ok('taze + boş EVSE → free', d.state === 'free', JSON.stringify(d));
  ok('taze → confirmed', d.confirmed === true && d.freshness === 'fresh');
  ok('yaş en yeni EVSE zamanından (3 dk)', d.ageMin === 3);
  ok('kaynak HERE', d.source === 'HERE');
  ok('metin: 1/2 boş + 3 dk önce + kaynak + canlı', txt(d) === '🟢 1/2 boş · 3 dk önce · kaynak: HERE canlı', txt(d));
}
{
  const d = fmt(av({ source: 'google', counts: { CHARGING: 3, RESERVED: 1 }, at: NOW - 1 * MIN }));
  ok('hepsi şarjda, UNKNOWN yok → busy', d.state === 'busy' && d.tone === 'busy');
  ok('busy metni dolu (0/4)', txt(d).startsWith('🔴 dolu (0/4)'), txt(d));
}
{
  const d = fmt(av({ source: 'google', counts: { OUTOFORDER: 1, INOPERATIVE: 1 }, at: NOW - 1 * MIN }));
  ok('hepsi arızalı → out', d.state === 'out' && txt(d).startsWith('⚫ arızalı'));
}

// ---------- 2) Yaşlanan (15 dk–2 sa): gösterilir ama canlı DEĞİL ----------
{
  const d = fmt(av({ source: 'tomtom', counts: { AVAILABLE: 2, CHARGING: 2 }, at: NOW - 40 * MIN }));
  ok('aging → free ama confirmed değil', d.state === 'free' && d.confirmed === false && d.freshness === 'aging');
  ok('aging metninde "canlı" yok, yaş var', !txt(d).includes('canlı') && txt(d).includes('40 dk önce'), txt(d));
}

// ---------- 3) UNKNOWN asla dolu/boş değil ----------
{
  const d = fmt(av({ source: 'here', evses: [{ status: 'UNKNOWN', at: NOW - MIN }, { status: 'UNKNOWN', at: NOW - MIN }] }));
  ok('hepsi UNKNOWN → unknown', NOT_SHOWN(d), JSON.stringify(d));
  ok('UNKNOWN metni durum sözcüğü içermez', noStatusWords(txt(d)) && txt(d).startsWith('doluluk bilgisi yok'), txt(d));
  ok('UNKNOWN metninde kaynak var', txt(d).includes('kaynak: HERE'));
}
{
  const d = fmt(av({ source: 'here', evses: [{ status: 'CHARGING', at: NOW - MIN }, { status: 'UNKNOWN', at: NOW - MIN }] }));
  ok('şarjda + UNKNOWN, boş yok → dolu DEĞİL (unknown)', NOT_SHOWN(d) && d.reason === 'unknown-evse');
}
{
  const d = fmt(av({ source: 'here', evses: [{ status: 'AVAILABLE', at: NOW - MIN }, { status: 'UNKNOWN', at: NOW - MIN }] }));
  ok('en az bir AVAILABLE + UNKNOWN → free (boş olduğu biliniyor)', d.state === 'free' && d.available === 1 && d.total === 2);
}

// ---------- 4) Eski / doğrulanmamış zaman ----------
{
  const d = fmt(av({ source: 'google', counts: { AVAILABLE: 4 }, at: NOW - 3 * 3600e3 }));
  ok('stale (3 sa) → unknown', NOT_SHOWN(d) && d.freshness === 'stale' && d.reason === 'stale');
  ok('stale metni: eski bilgi + kaynak, boş yok', txt(d) === 'doluluk bilgisi yok · eski bilgi · kaynak: Google' && noStatusWords(txt(d)), txt(d));
}
{
  const d = fmt(av({ source: 'ndw', counts: { AVAILABLE: 2, UNKNOWN: 1 } })); // NDW: timestampKind 'fetched'
  ok('fetched (sağlayıcı zamanı yok) → unknown/unverified', NOT_SHOWN(d) && d.freshness === 'unverified', JSON.stringify(d));
  ok('fetched metninde yaş yok, kaynak var', txt(d) === 'doluluk bilgisi yok · kaynak: NDW', txt(d));
}
{
  const d = fmt(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW + 10 * MIN }));
  ok('gelecekteki zaman (10 dk) → unverified', NOT_SHOWN(d) && d.freshness === 'unverified');
  const d2 = fmt(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW + 60e3 }));
  ok('küçük saat kayması (1 dk) tolere edilir → fresh, yaş 0', d2.state === 'free' && d2.freshness === 'fresh' && d2.ageMin === 0);
}
{
  const base = av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW - MIN });
  ok('now verilmezse → unverified', NOT_SHOWN(formatOccupancy(base)) && NOT_SHOWN(formatOccupancy(base, {})));
  ok('now NaN → unverified', NOT_SHOWN(fmt(base, NaN)));
}

// ---------- 5) Uydurma/simüle/tanınmayan kaynak ----------
{
  const mock = av({ source: 'mock', evses: [{ status: 'AVAILABLE', at: NOW - MIN }], simulated: true });
  const d = fmt(mock);
  ok('simulated → unknown, kaynak gösterilmez', NOT_SHOWN(d) && d.reason === 'simulated' && d.source === null && !txt(d).includes('kaynak'));
  const fake = deepFreeze({ ...av({ source: 'here', evses: [{ status: 'AVAILABLE', at: NOW - MIN }] }), simulated: true });
  ok('bilinen kaynak ama simulated:true → unknown', NOT_SHOWN(fmt(fake)));
  const noSim = { ...av({ source: 'here', evses: [{ status: 'AVAILABLE', at: NOW - MIN }] }) }; delete noSim.simulated;
  ok('simulated alanı yok → unknown (fail-closed)', NOT_SHOWN(fmt(noSim)));
  const odd = av({ source: 'someProvider<script>', counts: { AVAILABLE: 3 }, at: NOW - MIN });
  const d2 = fmt(odd);
  ok('tanınmayan kaynak → unknown, ham ad sızmaz', NOT_SHOWN(d2) && d2.source === null && !txt(d2).includes('script'), txt(d2));
  ok('mock kaynak listesinde yok', !('mock' in OCC_SOURCES));
}

// ---------- 6) null / bozuk girdi ----------
{
  const bad = [null, undefined, 0, 42, '', 'free', true, [], [1, 2], () => 1, {}, { source: 'here' }, Object.create(null)];
  ok('null/bozuk girdiler hata atmaz ve unknown', bad.every((b) => { try { return NOT_SHOWN(fmt(b)); } catch { return false; } }));
  const g = av({ source: 'google', counts: { AVAILABLE: 2, CHARGING: 1 }, at: NOW - MIN });
  const mut = (patch) => fmt({ ...g, ...patch });
  ok('negatif sayı → unknown', NOT_SHOWN(mut({ counts: { ...g.counts, AVAILABLE: -1 } })));
  ok('ondalık sayı → unknown', NOT_SHOWN(mut({ counts: { ...g.counts, AVAILABLE: 1.5 } })));
  ok('metin sayı → unknown', NOT_SHOWN(mut({ counts: { ...g.counts, AVAILABLE: '2' } })));
  ok('total ≠ sayı toplamı → unknown', NOT_SHOWN(mut({ total: 9 })));
  ok('available ≠ counts.AVAILABLE → unknown', NOT_SHOWN(mut({ available: 0 })));
  ok('counts yok → unknown', NOT_SHOWN(mut({ counts: null })));
  ok('counts hepsi 0 → unknown', NOT_SHOWN(mut({ counts: {}, total: null, available: null })));
  ok('at metin → unverified', NOT_SHOWN(mut({ at: '2026-11-14' })));
  ok('timestampKind eksik → unverified', NOT_SHOWN(mut({ timestampKind: undefined })));
  ok('aşırı büyük sayı → unknown', NOT_SHOWN(mut({ counts: { AVAILABLE: 1e9 }, total: null, available: null })));
  ok('occupancyText bozuk tanımda hata atmaz', occupancyText(null) === 'doluluk bilgisi yok' && occupancyText({}) === 'doluluk bilgisi yok');
}

// ---------- 7) slots sarmalayıcısı (occupancyClient biçimi) ----------
{
  const a = av({ source: 'here', evses: [{ status: 'AVAILABLE', at: NOW - 2 * MIN }] });
  const slots = deepFreeze({ total: 99, available: 99, out: 0, at: NOW, src: 'here', availability: a });
  const d = fmt(slots);
  ok('slots.availability okunur, eski total/available kullanılmaz', d.state === 'free' && d.total === 1 && d.available === 1);
  ok('availability yoksa eski slots alanlarından durum uydurulmaz', NOT_SHOWN(fmt({ total: 4, available: 4, src: 'google', at: NOW })));
}

// ---------- 8) Saflık: girdi değişmez, belirlenimci, yan etki kaynağı yok ----------
{
  const a = av({ source: 'here', evses: [{ status: 'AVAILABLE', at: NOW - MIN }] });
  const before = JSON.stringify(a);
  const d1 = fmt(a), d2 = fmt(a);
  ok('belirlenimci', JSON.stringify(d1) === JSON.stringify(d2));
  ok('girdi değişmedi (dondurulmuş girdiyle hata yok)', JSON.stringify(a) === before);
  ok('çıktı dondurulmuş', Object.isFrozen(d1) && Object.isFrozen(d1.parts));
  const src = readFileSync(join(root, 'js/routing/occupancyLabel.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '');
  const banned = [/\bimport\b/, /\bfetch\s*\(/, /Date\.now/, /new Date/, /localStorage|sessionStorage|indexedDB/, /\bdocument\b|\bwindow\b|navigator\./, /setTimeout|setInterval/, /console\./, /proxy/i, /key/i];
  for (const re of banned) ok(`kaynakta yasaklı kullanım yok: ${re}`, !re.test(src));
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const users = ['js/ui/stationCard.js', 'js/ui/stationsView.js', 'js/routing/occupancyClient.js', 'js/app.js'].filter((f) => { try { return readFileSync(join(root, f), 'utf8').includes('occupancyLabel'); } catch { return false; } });
  // D3-T4: occupancyLabel yalnız saf occupancyDecision üzerinden (slots.js arayüzü) yüklenir → sw.js SHELL'de olmalı; arayüz dosyaları doğrudan içe aktarmaz
  ok('arayüz dosyaları doğrudan içe aktarmaz; sw.js SHELL occupancyLabel.js içerir (D3-T4, occupancyDecision bağımlılığı)', sw.includes("'./js/routing/occupancyLabel.js'") && users.length === 0, users.join(','));
}

// ---------- 9) Yerelleştirme: şablonlar keys.json'da ve 11 dilde çevrili, yer tutucular korunur ----------
{
  const keys = JSON.parse(readFileSync(join(root, 'i18n', 'keys.json'), 'utf8'));
  const { LANGS } = await import(pathToFileURL(join(root, 'js/i18n/index.js')).href);
  const codes = (Array.isArray(LANGS) ? LANGS : Object.keys(LANGS)).map((l) => (typeof l === 'string' ? l : l.code)).filter((c) => c && c !== 'tr');
  ok('11 dil (tr dışı) bulundu', codes.length >= 10, codes.join(','));
  const ph = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [n, k] of Object.entries(OCC_TEMPLATES)) {
    ok(`keys.json "${n}" şablonunu içerir`, keys.includes(k), k);
    for (const c of codes) {
      const dict = (await import(pathToFileURL(join(root, 'js/i18n/lang', `${c}.js`)).href)).default;
      const v = dict[k];
      ok(`${c}: "${n}" çevrili ve yer tutucuları aynı`, typeof v === 'string' && v.trim() && ph(v) === ph(k), String(v));
    }
  }
  const de = (await import(pathToFileURL(join(root, 'js/i18n/lang/de.js')).href)).default;
  const tDe = (s, ...p) => p.reduce((o, v, i) => o.split(`{${i}}`).join(String(v)), de[s] ?? s);
  const d = fmt(av({ source: 'here', evses: [{ status: 'UNKNOWN', at: NOW - MIN }] }));
  ok('enjekte çevirmenle (de) unknown metni Türkçe durum sözcüğü içermez', !/doluluk|boş|dolu/.test(occupancyText(d, tDe)), occupancyText(d, tDe));
}

console.log(`${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
