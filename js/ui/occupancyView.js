// BL-P2-09 aşama 2A: istasyon doluluğu için YALITILMIŞ görüntü bileşeni — uygulamaya BAĞLI DEĞİL.
// Hiçbir modül (stationCard, stationsView, navigasyon, planlayıcı, giriş noktası) bunu içe aktarmaz; sw.js SHELL listesinde yok.
// Tek bağımlılık js/routing/occupancyLabel.js (saf). Ağ, depolama, saat okuması, sağlayıcı çağrısı yok: `now` ZORUNLU parametre.
//
// İki katman:
//  1) buildOccupancyView(slots, { now, translate }) → saf görüntü modeli (DOM yok). Durum, TAZELİK ve KAYNAK ayrı alanlardır.
//  2) renderOccupancyView(model, doc) → DOM düğümü ya da null (bölüm gizli). `doc` verilir (test için sahte document).
//
// Güvenlik kuralları (fail-closed):
//  - Resmî durum yalnızca occupancyLabel.formatOccupancy kararından gelir: UNKNOWN / eski / simüle / zamanı 'fetched' (sağlayıcı
//    zamanı yok) / gelecekte / tanınmayan kaynak / tutarsız sayı → boş/dolu/arızalı GÖSTERİLMEZ, 'canlı' asla yazılmaz.
//  - 'canlı' yalnızca desc.confirmed === true (taze + sağlayıcı zamanı) iken tazelik etiketine eklenir.
//  - Simüle ya da kaynağı tanınmayan veri hiç gösterilmez (atfedilecek kaynak yok).
//  - Google: harita dışı gösterim/atıf kararı henüz verilmedi (stationCard bugün "harita ekranında gösterilemez" der) → bu
//    bileşen Google kaynaklı resmî doluluğu GÖSTERMEZ (blocked: 'google-attribution-pending'). NDW kuralı occupancyLabel'dadır, değişmedi.
//  - Topluluk bildirimleri (👥 / Dolu bildirildi / Boş bildirildi) mevcut slots.js metinleriyle aynen korunur; hiçbir zaman 'canlı'
//    ya da resmî sayılmaz, kaynak etiketi almaz.
//  - Ne resmî ne topluluk verisi varsa model.hidden === true, renderOccupancyView null döner (bölüm gizlenir).
// Metinler mevcut Türkçe kaynak kalıplarıdır (i18n/keys.json + keys.extra.json, 11 dil); yeni çeviri anahtarı yok.
import { formatOccupancy, OCC_TEMPLATES } from '../routing/occupancyLabel.js';

/** Bileşenin kullandığı TÜM kalıplar (testte i18n anahtarlarına karşı denetlenir). */
export const VIEW_TEMPLATES = Object.freeze({
  ...OCC_TEMPLATES,
  now: 'şimdi',
  ago: '{0} dk önce',
  old: 'eski bilgi',
  cmBusy: '👥 {0} araç şarj ediyor',
  cmFull: '🔴 Dolu bildirildi',
  cmFree: '🟢 Boş bildirildi',
});

/** Topluluk bildirim yaşı bu dakikayı aşınca "eski bilgi" (slots.js ago() ile aynı eşik). */
const OLD_MIN = 90;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const fillTr = (s, ...p) => p.reduce((o, v, i) => o.split(`{${i}}`).join(String(v)), s);
const strip = (s) => String(s).replace(/^·\s*/, '');

/** Yaş metni: <1 dk "şimdi", <90 dk "{0} dk önce", sonrası "eski bilgi". Zaman geçersizse null. */
function agoText(at, now, tr) {
  if (typeof at !== 'number' || !Number.isFinite(at) || !Number.isFinite(now)) return null;
  const m = Math.max(0, Math.round((now - at) / 60e3));
  return m < 1 ? tr(VIEW_TEMPLATES.now) : m < OLD_MIN ? tr(VIEW_TEMPLATES.ago, m) : tr(VIEW_TEMPLATES.old);
}

/** Resmî/sağlayıcı doluluk bölümü ya da { blocked } / null. */
function officialPart(slots, now, tr) {
  const raw = isObj(slots?.availability) ? slots.availability : null;
  if (!raw) return null;
  if (typeof raw.source === 'string' && raw.source.trim().toLowerCase() === 'google') return { blocked: 'google-attribution-pending' };
  const d = formatOccupancy(raw, { now });
  if (!d.source) return null; // simüle / tanınmayan kaynak / biçimsiz: atfedilemez → hiç gösterilmez
  const head = d.parts[0];
  const statusText = strip(tr(head.template, ...head.params));
  let freshnessText = null;
  if (d.state !== 'unknown') {
    const age = d.ageMin < 1 ? tr(VIEW_TEMPLATES.now) : tr(VIEW_TEMPLATES.ago, d.ageMin);
    freshnessText = d.confirmed ? `${age} · ${tr(VIEW_TEMPLATES.live)}` : age;
  } else if (d.freshness === 'stale') {
    freshnessText = strip(tr(VIEW_TEMPLATES.stale));
  } // 'unverified' (ör. NDW 'fetched' zamanı): yaş da 'canlı' da yazılmaz
  return Object.freeze({
    state: d.state, tone: d.tone, confirmed: d.confirmed === true, freshness: d.freshness, reason: d.reason,
    statusText, freshnessText,
    source: d.source, sourceText: strip(tr(VIEW_TEMPLATES.source, d.source, '')),
  });
}

/** Topluluk satırları (mevcut slots.js metinleri). Asla canlı/resmî değildir. */
function communityParts(slots, now, tr) {
  const cm = isObj(slots?.community) ? slots.community : null;
  if (!cm) return [];
  const out = [];
  if (Number.isInteger(cm.busy) && cm.busy > 0) out.push(Object.freeze({ kind: 'busy', text: tr(VIEW_TEMPLATES.cmBusy, cm.busy), ageText: null }));
  const r = isObj(cm.report) ? cm.report : null;
  if (r && (r.status === 'full' || r.status === 'free')) {
    const ageText = agoText(r.at, now, tr);
    if (ageText != null) out.push(Object.freeze({ kind: r.status === 'full' ? 'reportFull' : 'reportFree', text: tr(r.status === 'full' ? VIEW_TEMPLATES.cmFull : VIEW_TEMPLATES.cmFree), ageText }));
  }
  return out;
}

/**
 * Saf görüntü modeli. Girdiyi değiştirmez; aynı girdi + now → aynı çıktı.
 * @param {object|null} slots occupancyClient biçimi ({ availability, community, ... })
 * @param {{ now:number, translate?:(template:string, ...params:any[])=>string }} opts
 * @returns {{ hidden:boolean, official:object|null, blocked:string|null, community:Array<{kind,text,ageText}> }}
 */
export function buildOccupancyView(slots, { now, translate = null } = {}) {
  const tr = typeof translate === 'function' ? translate : fillTr;
  const off = officialPart(slots, now, tr);
  const blocked = off?.blocked || null;
  const official = off && !off.blocked ? off : null;
  const community = Object.freeze(communityParts(slots, now, tr));
  return Object.freeze({ hidden: !official && !community.length, official, blocked, community });
}

/**
 * Modeli DOM'a çevirir. Gizliyse null. Kaynak adı (marka) çevrilmez: translate=false, sınıf 'attrib'.
 * @param {ReturnType<typeof buildOccupancyView>} model
 * @param {Document} doc
 */
export function renderOccupancyView(model, doc) {
  if (!model || model.hidden || !doc) return null;
  const span = (cls, text) => { const s = doc.createElement('span'); if (cls) s.className = cls; s.textContent = text; return s; };
  const root = doc.createElement('div');
  root.className = 'occ-view';
  const o = model.official;
  if (o) {
    const row = doc.createElement('div');
    row.className = `occ-official occ-${o.tone}`;
    row.append(span('occ-status', o.statusText));
    if (o.freshnessText) row.append(' · ', span('occ-fresh', o.freshnessText));
    const src = span('occ-source attrib', o.sourceText);
    src.translate = false;
    row.append(' · ', src);
    root.append(row);
  }
  for (const c of model.community) {
    const row = doc.createElement('div');
    row.className = `occ-community occ-cm-${c.kind}`;
    row.append(span('occ-cm-text', c.text));
    if (c.ageText) row.append(' · ', span('occ-fresh', c.ageText));
    root.append(row);
  }
  return root;
}
