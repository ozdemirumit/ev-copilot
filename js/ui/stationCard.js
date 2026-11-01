// Haritada bir istasyon iğnesine dokununca açılan kart: ad, operatör, güç, tahmini ve canlı/bildirilen fiyat, canlı doluluk (Premium), topluluk durumu,
// Git / Haritalar düğmeleri ve Dolu / Boş / Fiyat bildirimi. Canlı bilgi tek istasyon için sunucudan istenir (/v1/occupancy; Hollanda'da NDW, Türkiye'de topluluk).
import { effective } from '../state.js';
import { mapApi } from './mapView.js';
import { toast } from './toast.js';
import { tr } from '../i18n/index.js';
import { fetchAvailability } from '../routing/occupancyClient.js';
import { slotEl, livePrice } from '../routing/slots.js';
import { getSession, proxyFetch, proxyHas } from '../net/proxy.js';
import { reportStatus } from '../account/community.js';
import { goToStation } from '../nav/nearby.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || '', textContent: text ?? '' });
let current = null;
let token = 0; // eski yanıt yeni karta yazılmasın

function close() {
  current = null;
  token++;
  $('station-card')?.classList.add('hidden');
}

function btn(text, fn, cls = 'btn ghost sm') {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

function paintLive(box, s, state) {
  box.replaceChildren();
  const note = (t) => box.append(el('div', 'small muted', t));
  if (state === 'loading') return note('Canlı bilgi alınıyor…');
  if (state === 'login') return note('Canlı doluluk için hesapla giriş yap');
  if (state === 'locked') return note('Canlı doluluk ve kWh fiyatı Premium üyelere özeldir.');
  const node = slotEl(s, '');
  const lp = livePrice(s);
  if (node) { const d = el('div', 'live-slots'); d.append(node); box.append(d); }
  if (lp) box.append(el('div', 'live-price', lp.text));
  if (lp?.extra) box.append(el('div', 'small muted', 'Ek ücret var (oturum başı ya da süre)'));
  if (!node && !lp) note('Bu istasyon için canlı doluluk verisi yok');
}

async function load(s, box) {
  const my = ++token;
  if (!getSession()) return paintLive(box, s, 'login');
  if (proxyHas('occupancyLocked')) return paintLive(box, s, 'locked');
  if (!proxyHas('occupancy')) return paintLive(box, s, 'none');
  paintLive(box, s, 'loading');
  const res = await fetchAvailability([s], 1, effective().soc);
  if (my !== token) return;
  if (res.has(s.id)) s.slots = res.get(s.id);
  paintLive(box, s, 'done');
}

function open(s) {
  current = s;
  const card = $('station-card');
  const head = el('div', 'row between');
  head.append(el('b', 'sc-title', s.name));
  head.append(btn('✕', close, 'sheet-x'));
  const meta = el('div', 'small muted');
  meta.append(el('span', '', s.opName || ''), ' · ', el('span', '', `${s.slow ? tr('AC/yavaş') + ' ' : ''}${s.kw} kW${s.uncertain ? '*' : ''}`));
  const price = el('div', 'sc-price', s.price != null ? `${s.price.toFixed(2)} TL/kWh (tahmini)` : '');
  const live = el('div', 'stack sc-live');
  const acts = el('div', 'row wrap');
  acts.append(btn('🧭 Git', () => { close(); goToStation(s); }, 'btn primary sm'));
  const a = el('a', 'btn ghost sm', '↗ Haritalar');
  a.href = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=driving`;
  a.target = '_blank';
  a.rel = 'noopener';
  acts.append(a);
  if (getSession()) {
    const say = async (status) => {
      const ok = await reportStatus(s, status);
      toast(ok ? 'Teşekkürler: bildirildi' : 'Bildirim gönderilemedi');
      if (ok) { s.slots = { ...(s.slots || { total: null, available: null, out: 0 }), checked: Date.now(), community: { busy: s.slots?.community?.busy ?? 0, report: { status, at: Date.now() } } }; paintLive(live, s, 'done'); }
    };
    acts.append(btn('🔴 Dolu', () => say('full')), btn('🟢 Boş', () => say('free')));
    acts.append(btn('💳 Fiyat bildir', async () => {
      const v = prompt(tr('Bu istasyonun kWh fiyatı (TL)?'));
      if (v == null) return;
      const p = Number(String(v).replace(',', '.'));
      if (!(p > 0.05 && p < 100)) return toast('Geçerli bir fiyat gir');
      try {
        const r = await proxyFetch('/v1/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: s.lat, lon: s.lon, kwh: p, currency: 'TRY' }), signal: AbortSignal.timeout(15000) });
        toast(r.ok ? 'Teşekkürler: fiyat kaydedildi' : 'Fiyat gönderilemedi');
      } catch { toast('Fiyat gönderilemedi'); }
    }));
  }
  card.replaceChildren(head, meta, price, live, acts);
  card.classList.remove('hidden');
  load(s, live);
}

export function initStationCard() {
  mapApi.onStation = open; // harita iğneleri dokununca çağırır (ui/mapView.js)
  document.addEventListener('tabchange', (e) => { if (e.detail !== 'map') close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
