// D3-T4: doluluk ARAYÜZÜ yalnız üç durum — 🟢 Müsait / 🔴 Dolu / ⚪ Bilinmiyor (K5) — çevrimdışı test.
// node scripts/test-occupancy-ui.mjs   (ağ yok, anahtar yok, sunucu açılmaz; sentetik fikstür + sahte document + kaynak denetimi)
// Kurallar: resmî durum yalnız saf occupancyDecision kararından gelir (K1 sağlayıcı zaman damgası zorunlu, K2 NDW 0/N,
// K4 ingest ≠ doğrulanmış, AGE > 15 dk → Bilinmiyor). Topluluk bildirimi ayrı satırdır (K3), resmî durumu değiştirmez.
// Planlayıcı kararları (slotKind / isFresh) bu görevde DEĞİŞMEZ (test-occupancy-consistency-contract G1/G2/G4/G5/G7).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const read = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error('ağ yasak (test)'); };

// Sahte document: slotEl'in kullandığı yüzey
class El { constructor(tag) { this.tagName = tag; this.className = ''; this.children = []; this._text = ''; this.translate = true; }
  append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? { text: x } : x); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (c instanceof El ? c.textContent : c.text)).join(''); } }
globalThis.document = { createElement: (t) => new El(t) };
const all = (el, out = []) => { if (el instanceof El) { out.push(el); el.children.forEach((c) => all(c, out)); } return out; };
const stateSpans = (el) => all(el).filter((e) => /\bocc-state\b/.test(e.className));

const { slotEl, slotLabel, slotKind } = await imp('js/routing/slots.js');
const { buildAvailability, fromNdwAvailabilities } = await imp('server/availability.mjs');

const NOW = Date.now();
Date.now = () => NOW; // slots.js saati kendisi okur: sabit saat → 15 dk sınırı belirlenimci
const MIN = 60e3;
const LABELS = ['🟢 Müsait', '🔴 Dolu', '⚪ Bilinmiyor'];
const prov = (source, counts, agoMin) => buildAvailability({ source, counts, at: NOW - agoMin * MIN, fetchedAt: NOW, now: NOW });
const fetched = (source, counts) => buildAvailability({ source, counts, at: null, fetchedAt: NOW, now: NOW });
const slots = (src, av, extra = {}) => ({ total: av?.total ?? null, available: av?.available ?? null, out: 0, at: av?.at ?? null, checked: NOW, src, price: null, community: null, availability: av, ...extra });
const st = (sl) => ({ id: 'x', name: 'x', slots: sl });
const txt = (sl, lead) => slotEl(st(sl), lead)?.textContent ?? null;
const state = (sl) => stateSpans(slotEl(st(sl)) || new El('x')).map((e) => e.textContent);
const NO_OLD_WORDS = (s) => !/boş\b|dolu \(|arızalı|canlı|eski bilgi|doluluk bilgisi/.test(s);

// ---------- 1) Müsait / Dolu: yalnız sağlayıcı zamanlı ve ≤ 15 dk ----------
{
  const free = slots('here', prov('here', { AVAILABLE: 3, CHARGING: 1 }, 3));
  const t = txt(free);
  ok('sağlayıcı zamanlı taze 3/4 → 🟢 Müsait', JSON.stringify(state(free)) === JSON.stringify(['🟢 Müsait']), t);
  ok('Müsait: sayı 3/4 ve yaş "3 dk önce" korunur', /3\/4/.test(t) && /3 dk önce/.test(t), t);
  ok('Müsait: eski metinler (boş/dolu (0/N)/arızalı/canlı) yok', NO_OLD_WORDS(t), t);
  ok('Müsait: HERE atfı korunur', /· HERE$/.test(t), t);
  ok('lead varsayılan " · "', t.startsWith(' · 🟢 Müsait'), t);
  ok("lead '' (kart)", txt(free, '').startsWith('🟢 Müsait'), txt(free, ''));
  const atfi = all(slotEl(st(free))).find((e) => e.className === 'attrib');
  ok('atıf çevrilmez (translate=false)', atfi && atfi.translate === false);

  const busy = slots('tomtom', prov('tomtom', { CHARGING: 3, RESERVED: 1 }, 0));
  ok('sağlayıcı zamanlı taze 0/4 dolu → 🔴 Dolu', JSON.stringify(state(busy)) === JSON.stringify(['🔴 Dolu']), txt(busy));
  ok('Dolu: 0/4 + şimdi + TomTom', /0\/4/.test(txt(busy)) && /şimdi/.test(txt(busy)) && /· TomTom$/.test(txt(busy)) && NO_OLD_WORDS(txt(busy)), txt(busy));

  const out = slots('ocpi', prov('ocpi', { OUTOFORDER: 2, INOPERATIVE: 1 }, 2));
  ok('hepsi arızalı (doğrulanmış) → 🔴 Dolu (dördüncü durum yok)', JSON.stringify(state(out)) === JSON.stringify(['🔴 Dolu']) && !/arızalı/.test(txt(out)), txt(out));

  const g = slots('google', prov('google', { AVAILABLE: 1, CHARGING: 1 }, 1));
  ok('Google taze → Müsait + "Google Maps" atfı (mevcut kural)', state(g)[0] === '🟢 Müsait' && /· Google Maps$/.test(txt(g)), txt(g));

  const at15 = slots('here', prov('here', { AVAILABLE: 1 }, 15));
  ok('tam 15 dk → hâlâ Müsait (15 dk dahil)', state(at15)[0] === '🟢 Müsait' && /15 dk önce/.test(txt(at15)), txt(at15));
}

// ---------- 2) Bilinmiyor: zaman damgası yok / 15 dk üstü / doğrulanmamış ----------
{
  const UNK = (name, sl) => {
    const t = txt(sl);
    ok(`${name} → ⚪ Bilinmiyor`, JSON.stringify(state(sl)) === JSON.stringify(['⚪ Bilinmiyor']), t);
    ok(`${name}: sayı/yaş/canlı/atıf yazılmaz`, t != null && !/\d+\/\d+|dk önce|şimdi|TomTom|HERE|Google|NDW/.test(t) && NO_OLD_WORDS(t), t);
  };
  UNK('TomTom zaman damgası yok (fetched) 2/4', slots('tomtom', fetched('tomtom', { AVAILABLE: 2, CHARGING: 2 })));
  UNK('TomTom fetched 0/4', slots('tomtom', fetched('tomtom', { CHARGING: 4 })));
  const ndw = (a, n) => fromNdwAvailabilities([{ available: a, total: n, power_max: 150000 }], { now: NOW });
  UNK('NDW fetched 2/4 (okuma anı tazelik değildir)', slots('ndw', ndw(2, 4)));
  UNK('NDW fetched 0/4 (asla "dolu")', slots('ndw', ndw(0, 4)));
  UNK('NDW sağlayıcı zamanlı 0/4 (K2)', slots('ndw', { ...ndw(0, 4), timestampKind: 'provider', at: NOW - MIN }));
  UNK('16 dk eski sağlayıcı kaydı (AGE)', slots('here', prov('here', { AVAILABLE: 3, CHARGING: 1 }, 16)));
  UNK('15 dk + 1 sn eski (AGE sınırı)', slots('here', prov('here', { AVAILABLE: 1 }, 15 + 1 / 60)));
  UNK('3 sa eski sağlayıcı kaydı', slots('here', prov('here', { AVAILABLE: 3, CHARGING: 1 }, 180)));
  UNK('sağlayıcı türü ama at yok', slots('here', { ...prov('here', { AVAILABLE: 1 }, 1), at: null }));
  UNK('gelecek zaman (+10 dk)', slots('here', prov('here', { AVAILABLE: 1 }, -10)));
  UNK('simüle (mock)', slots('here', { ...prov('here', { AVAILABLE: 1 }, 1), simulated: true }));
  UNK('tanınmayan kaynak', slots('foo', { ...prov('foo', { AVAILABLE: 1 }, 1) }));
  UNK('tutarsız sayı', slots('here', { ...prov('here', { AVAILABLE: 1, CHARGING: 1 }, 1), total: 9 }));
  UNK('availability yok, eski alan 2/4 + at=şimdi (normalize edilmemiş)', { total: 4, available: 2, out: 0, at: NOW, checked: NOW, src: 'tomtom', price: null, community: null, availability: null });
  UNK('availability yok, eski alan 0/4', { total: 4, available: 0, out: 0, at: NOW, checked: NOW, src: 'ndw', price: null, community: null, availability: null });
  UNK('kaynak "community" resmî biçimde', slots('here', { ...prov('here', { AVAILABLE: 2 }, 1), source: 'community' }));
}

// ---------- 3) Veri yoksa bölüm gizli (mevcut UX) ----------
{
  ok('slots yok → null', slotEl(st(null)) === null);
  ok('yalnız fiyat (sayı ve availability yok) → null', slotEl(st({ total: null, available: null, out: 0, at: null, checked: NOW, src: 'ndw', price: { kwh: 0.4, currency: 'EUR' }, community: null, availability: null })) === null);
}

// ---------- 4) Topluluk: ayrı satır, metinler aynı, resmî durumu değiştirmez (K3) ----------
{
  const base = { total: null, available: null, out: 0, at: null, checked: NOW, src: null, price: null, availability: null };
  const cm = (c) => ({ ...base, community: c });
  const t1 = txt(cm({ busy: 2, report: null }));
  ok('yalnız topluluk varlığı → "👥 2 araç şarj ediyor", resmî durum yazılmaz', t1 === ' · 👥 2 araç şarj ediyor' && state(cm({ busy: 2, report: null })).length === 0, t1);
  const t2 = txt(cm({ busy: 0, report: { status: 'full', at: NOW - 5 * MIN } }));
  ok('topluluk Dolu bildirimi (5 dk) aynı metin', t2 === ' · 🔴 Dolu bildirildi · 5 dk önce', t2);
  const t3 = txt(cm({ busy: 0, report: { status: 'free', at: NOW - 20e3 } }));
  ok('topluluk Boş bildirimi (<1 dk) aynı metin', t3 === ' · 🟢 Boş bildirildi · şimdi', t3);
  ok('61 dk eski topluluk bildirimi gösterilmez (sunucu REPORT_MS 60 dk)', slotEl(st(cm({ busy: 0, report: { status: 'full', at: NOW - 61 * MIN } }))) === null);
  ok('zamansız topluluk bildirimi gösterilmez', slotEl(st(cm({ busy: 0, report: { status: 'free' } }))) === null);
  const mix = slots('tomtom', fetched('tomtom', { AVAILABLE: 2, CHARGING: 2 }), { community: { busy: 1, report: { status: 'free', at: NOW - 2 * MIN } } });
  const tm = txt(mix);
  ok('topluluk Boş + resmî doğrulanmamış → ⚪ Bilinmiyor kalır (Müsait olmaz)', JSON.stringify(state(mix)) === JSON.stringify(['⚪ Bilinmiyor']) && /🟢 Boş bildirildi · 2 dk önce/.test(tm) && /👥 1 araç şarj ediyor/.test(tm), tm);
  const mix2 = slots('here', prov('here', { AVAILABLE: 2, CHARGING: 1 }, 1), { community: { busy: 0, report: { status: 'full', at: NOW } } });
  ok('topluluk Dolu resmî doğrulanmış Müsait\'i ezmez', state(mix2)[0] === '🟢 Müsait' && /🔴 Dolu bildirildi/.test(txt(mix2)), txt(mix2));
  ok('topluluk satırı occ-state sınıfı almaz (resmî değil)', stateSpans(slotEl(st(cm({ busy: 3, report: { status: 'full', at: NOW } })))).length === 0);
}

// ---------- 5) Yalnız üç durum etiketi; slotLabel aynı karar ----------
{
  const fx = [
    slots('here', prov('here', { AVAILABLE: 3, CHARGING: 1 }, 3)), slots('here', prov('here', { CHARGING: 2 }, 3)),
    slots('here', prov('here', { OUTOFORDER: 2 }, 3)), slots('tomtom', fetched('tomtom', { AVAILABLE: 1 })),
    slots('here', prov('here', { AVAILABLE: 3 }, 40)),
  ];
  const seen = new Set(fx.flatMap(state));
  ok('üretilen durum etiketleri ⊆ {Müsait, Dolu, Bilinmiyor}', [...seen].every((s) => LABELS.includes(s)) && seen.size === 3, [...seen].join());
  ok('slotLabel Müsait', /^🟢 Müsait · 3\/4 · 3 dk önce$/.test(slotLabel(st(fx[0]))), slotLabel(st(fx[0])));
  ok('slotLabel Dolu', /^🔴 Dolu · 0\/2 · 3 dk önce$/.test(slotLabel(st(fx[1]))), slotLabel(st(fx[1])));
  ok('slotLabel Bilinmiyor (fetched)', slotLabel(st(fx[3])) === '⚪ Bilinmiyor', slotLabel(st(fx[3])));
  ok('slotLabel veri yok → ""', slotLabel(st(null)) === '');
}

// ---------- 6) Planlayıcı kararı bu görevde DEĞİŞMEDİ (ayrı R3-b/R3-c işi) ----------
{
  const ndw0 = slots('ndw', fromNdwAvailabilities([{ available: 0, total: 4, power_max: 150000 }], { now: NOW }));
  ok("slotKind(NDW fetched 0/4) hâlâ 'full' (planlayıcı değişmedi; G2 açık)", slotKind(st(ndw0)) === 'full');
  ok('ama arayüz Bilinmiyor gösterir', state(ndw0)[0] === '⚪ Bilinmiyor');
}

// ---------- 7) Kaynak / paket denetimi ----------
{
  const strip = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const sl = strip(read('js/routing/slots.js'));
  const imports = [...sl.matchAll(/import\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
  ok('slots.js yalnız saf occupancyDecision + communityReport içe aktarır', JSON.stringify(imports) === JSON.stringify(['./communityReport.js', './occupancyDecision.js']), JSON.stringify(imports));
  const body = (name) => { const i = sl.indexOf(`export function ${name}`) >= 0 ? sl.indexOf(`export function ${name}`) : sl.indexOf(`export const ${name}`); const j = sl.indexOf('\nexport ', i + 1); return sl.slice(i, j < 0 ? undefined : j); };
  ok('slotKind / isFresh / slotsOf karar modüllerini kullanmaz (planlayıcı değişmedi)', ['slotKind', 'isFresh', 'slotsOf'].every((n) => { const b = body(n); return b.length > 20 && !/occupancyDecision|communityReport/.test(b); }));
  const nb = read('js/nav/nearby.js');
  ok('nearby: dördüncü etiket "doluluk bilgisi eski" kaldırıldı, liste slotEl(s) kullanır', !/doluluk bilgisi eski/.test(nb) && /const slotNode = slotEl\(s\);/.test(nb));
  const sw = read('sw.js');
  const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] || '');
  for (const f of ['./js/routing/occupancyDecision.js', './js/routing/occupancyLabel.js', './js/routing/communityReport.js', './js/routing/slots.js']) ok(`sw.js SHELL içerir: ${f}`, shell.includes(`'${f}'`));
}

// ---------- 8) Çeviri: yeni durum etiketleri 11 dilde ----------
{
  const keys = new Set([...JSON.parse(read('i18n/keys.json')), ...JSON.parse(read('i18n/keys.extra.json'))]);
  for (const k of [...LABELS, '👥 {0} araç şarj ediyor', '🔴 Dolu bildirildi', '🟢 Boş bildirildi', 'şimdi', '{0} dk önce']) ok(`çeviri anahtarı var: ${k}`, keys.has(k));
  const { LANGS } = await imp('js/i18n/index.js').catch(() => ({}));
  const codes = (Array.isArray(LANGS) ? LANGS.map((l) => (typeof l === 'string' ? l : l.code)) : []).filter((c) => c && c !== 'tr');
  ok('11 dil bulundu', codes.length === 11, codes.join());
  for (const c of codes) {
    const d = { ...(await imp(`js/i18n/lang/${c}.js`)).default, ...(await imp(`js/i18n/lang/${c}.extra.js`)).default };
    for (const k of LABELS) ok(`${c}: "${k}" çevrili ve emoji korunur`, typeof d[k] === 'string' && d[k].trim() && d[k].startsWith(k.slice(0, 2)) && d[k] !== k, d[k]);
  }
}

ok('gerçek fetch hiç çağrılmadı', fetchCalls === 0, String(fetchCalls));
console.log(`test-occupancy-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
