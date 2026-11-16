// D3-T4: server/availability.mjs `decision` alanı istemciye (js/routing/occupancyClient.js fetchAvailability) KAYIPSIZ geçer ve
// arayüz (slots.js slotEl/slotLabel) sunucu kararı güvenilmezse asla Müsait/Dolu göstermez (fail-closed; istemci kararı da ayrıca gerekir).
// node scripts/test-occupancy-client-decision.mjs   (ağ yok: fetch sahte; anahtar yok, sahte erişim kodu; sunucu açılmaz)
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(root, p)).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

// Sahte depolama: sahte erişim kodu + occupancy özelliği (gerçek değer değil). Sunucu adresi sahte, istek sahte fetch'e gider.
const store = new Map([
  ['evcp.proxyCode', JSON.stringify('test-code')],
  ['evcp.proxyUrl', JSON.stringify('http://proxy.invalid')],
  ['evcp.proxyCaps', JSON.stringify({ occupancy: true })],
  ['evcp.deviceId', JSON.stringify('d_testdevice0123456789')],
]);
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const NOW = Date.now();
Date.now = () => NOW;
const MIN = 60e3;
const { buildAvailability, withOccupancyDecision } = await imp('server/availability.mjs');

let calls = [], reply = null;
globalThis.fetch = async (url, init) => {
  calls.push(String(url));
  if (!String(url).startsWith('http://proxy.invalid/')) throw new Error('ağ yasak (test): ' + url);
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(reply)) }; // gerçek ağ gibi JSON gidiş-dönüş
};

const { fetchAvailability } = await imp('js/routing/occupancyClient.js');

// Sunucu tarafı sonuç: eski alanlar + availability + decision (withOccupancyDecision ile, sentetik)
const prov = (source, counts, agoMin) => buildAvailability({ source, counts, at: NOW - agoMin * MIN, fetchedAt: NOW, now: NOW });
const fetched = (source, counts) => buildAvailability({ source, counts, at: null, fetchedAt: NOW, now: NOW });
const res = (src, av) => withOccupancyDecision({ total: av.total, available: av.available, out: 0, at: av.at ?? NOW, src, price: null, community: null, availability: av }, NOW);

const R = {
  free: res('here', prov('here', { AVAILABLE: 3, CHARGING: 1 }, 2)),
  noTs: res('tomtom', fetched('tomtom', { AVAILABLE: 2, CHARGING: 2 })),
  old: res('here', prov('here', { AVAILABLE: 2 }, 20)),
};
ok('fikstür: sunucu decision üretir (free trusted, noTs/old değil)', R.free.decision?.trusted === true && R.noTs.decision?.trusted === false && R.old.decision?.trusted === false, JSON.stringify([R.free.decision, R.noTs.decision, R.old.decision]));

reply = { results: { a: R.free, b: R.noTs, c: R.old, d: null } };
const st = (id) => ({ id, lat: 52, lon: 4.9, name: id, opName: 'x' });
const out = await fetchAvailability([st('a'), st('b'), st('c'), st('d')], 4);
ok('istek yalnız sahte sunucuya gitti', calls.length === 1 && calls[0] === 'http://proxy.invalid/v1/occupancy', JSON.stringify(calls));

// ---------- 1) decision kayıpsız ----------
for (const id of ['a', 'b', 'c']) {
  const got = out.get(id)?.decision;
  ok(`${id}: decision kayıpsız taşınır (tüm alanlar aynı)`, JSON.stringify(got) === JSON.stringify(JSON.parse(JSON.stringify(R[{ a: 'free', b: 'noTs', c: 'old' }[id]].decision))), JSON.stringify(got));
}
ok('veri yok (null) → kayıt yok', !out.has('d'));
ok('mevcut alanlar korunur (availability, src, total/available)', out.get('a').availability?.source === 'here' && out.get('a').src === 'here' && out.get('a').total === 4 && out.get('a').available === 3);
reply = { results: { e: { total: 4, available: 2, out: 0, at: NOW, src: 'tomtom', availability: null } } };
const old = await fetchAvailability([st('e')], 1);
ok('eski sunucu (decision yok) → decision null (uydurma yok)', old.get('e')?.decision === null, JSON.stringify(old.get('e')));
reply = { results: { f: { ...R.free, decision: 'trusted' } } };
const bad = await fetchAvailability([st('f')], 1);
ok('biçimsiz decision (nesne değil) → null', bad.get('f')?.decision === null, JSON.stringify(bad.get('f')?.decision));

// ---------- 2) Arayüz: sunucu kararı güvenilmezse fail-closed ----------
class El { constructor(tag) { this.tagName = tag; this.className = ''; this.children = []; this._text = ''; this.translate = true; }
  append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? { text: x } : x); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (c instanceof El ? c.textContent : c.text)).join(''); } }
globalThis.document = { createElement: (t) => new El(t) };
const { slotEl, slotLabel } = await imp('js/routing/slots.js');
const ui = (sl) => slotLabel({ id: 'x', slots: sl });

ok('istemci a (sunucu trusted + taze sağlayıcı zamanı) → Müsait', /^🟢 Müsait · 3\/4 · 2 dk önce$/.test(ui(out.get('a'))), ui(out.get('a')));
ok('istemci b (zaman damgası yok) → Bilinmiyor', ui(out.get('b')) === '⚪ Bilinmiyor', ui(out.get('b')));
ok('istemci c (20 dk eski) → Bilinmiyor', ui(out.get('c')) === '⚪ Bilinmiyor', ui(out.get('c')));
const a = out.get('a');
const veto = { ...a, decision: { trusted: false, state: 'unknown', reason: 'ndw-zero-unverified', source: 'HERE', ageMin: null } };
ok('sunucu decision güvenilmez + istemci verisi taze → yine Bilinmiyor (fail-closed)', ui(veto) === '⚪ Bilinmiyor' && slotEl({ slots: veto })?.textContent === ' · ⚪ Bilinmiyor', ui(veto));
const forged = { ...out.get('b'), decision: { trusted: true, state: 'free', reason: null, source: 'TomTom', ageMin: 0 } };
ok('sunucu decision trusted ama istemci zaman damgası yok → Bilinmiyor (sunucu kararı tek başına Müsait yapmaz)', ui(forged) === '⚪ Bilinmiyor', ui(forged));
ok('decision yok (eski sunucu) → istemci kararı geçerli (Müsait korunur)', /^🟢 Müsait/.test(ui({ ...a, decision: null })), ui({ ...a, decision: null }));

// ---------- 3) Topluluk asla resmî Müsait değil ----------
const cmOnly = { total: null, available: null, out: 0, at: null, checked: NOW, src: null, price: null, availability: null, decision: null, community: { busy: 0, report: { status: 'free', at: NOW - MIN } } };
ok('yalnız topluluk "Boş" → resmî Müsait yazılmaz', !/Müsait/.test(slotEl({ slots: cmOnly })?.textContent || '') && /Boş bildirildi/.test(slotEl({ slots: cmOnly })?.textContent || ''), slotEl({ slots: cmOnly })?.textContent);
const cmDec = { ...a, availability: { ...a.availability, source: 'community' }, decision: { trusted: true, state: 'free', reason: null, source: 'community', ageMin: 0 } };
ok('kaynak community + sahte trusted decision → Bilinmiyor', ui(cmDec) === '⚪ Bilinmiyor', ui(cmDec));

ok('gerçek ağa istek yok', calls.every((u) => u.startsWith('http://proxy.invalid/')), JSON.stringify(calls));
console.log(`test-occupancy-client-decision: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
