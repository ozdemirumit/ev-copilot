// Şarj durağı "AKTİF ROTA ÜZERİNDE" mi? (saf; ağ/DOM yok) — v0.99.97
// Sorun (canlı Beta v0.99.96, Yunanistan A106): navigasyon sırasındaki yeniden planlamalar (livePlan 25 km/pil sapması, yol önü trafik/hava,
// doluluk) planlayıcıyı 3 km'lik istasyon koridoruyla yeniden çalıştırıyordu. Rota çizgisinden km'lerce uzak (otoyoldan çıkmayı gerektiren)
// bir istasyon "Sonraki şarj" olarak seçilebiliyor, ama rota (v0.99.52 durak üzerinden rota yalnız ilk planlamada) ondan geçmiyordu.
// Kural: kullanıcının onayı olmadan rota DEĞİŞMEZ; bu yüzden otomatik seçilen durak mevcut rotanın üzerinde olmalıdır:
//  - tam çözünürlüklü rota çizgisine düz çizgi uzaklığı ≤ ON_ROUTE_KM (yalnızca ön eleme; yakınlık erişim kanıtı DEĞİLDİR), ve
//  - yol ağıyla (stopAccess.verifyStops: rotada önce A → istasyon → sonra B, gidiş yönü kısıtlı) sapma ≤ ON_ROUTE_DETOUR_KM.
// Karşı şerit/bariyer (yol ağı sapması orantısız) → 'blocked'. Erişilebilir ama rotadan ayrılmayı gerektiren → 'off' (yalnız kullanıcı onayıyla
// rota değişikliği seçeneği olarak sunulur). Yol ağı sorgusu yapılamadıysa → 'unverified'. v0.99.107: 'unverified' artık OTOMATİK SEÇİLMEZ
// (fail-closed; Yunanistan A1 Atina–Selanik karşı şerit EKO regresyonu); yalnız kullanıcının elle seçtiği durakta uyarı + onayla kalır.

/** Ön eleme: tam rota çizgisine bundan uzak istasyon rota üstü sayılmaz (dinlenme tesisi şarjı çizgiye birkaç yüz metre). */
export const ON_ROUTE_KM = 0.5;
/** Yol ağıyla ölçülen ek yol (giriş + çıkış, km) bundan fazlaysa durak rotadan ayrılmayı gerektirir ('off'). */
export const ON_ROUTE_DETOUR_KM = 2;
/** Rota dışı seçenek (onaylı rota değişikliği) en çok bu kadar istasyon için hesaplanır (sağlayıcı isteği sınırı). */
export const MAX_ALTERNATIVES = 3;

/**
 * İstasyonun aktif rotaya göre durumu. lineOffKm: tam çözünürlüklü rota çizgisine düz çizgi uzaklığı (km; bilinmiyorsa null);
 * access: stopAccess.applyAccess alanı ({ verified, ok, detourKm }) ya da yok.
 * Dönüş: 'on' (doğrulandı, rotada) | 'unverified' (çizgide ama yol ağıyla doğrulanmadı) | 'off' (rotadan ayrılmak gerekir) | 'blocked' (karşı yön/erişilemez).
 */
export function routeStatus({ lineOffKm = null, access = null } = {}) {
  if (access?.verified && access.ok === false) return 'blocked';
  if (access?.verified && Number.isFinite(access.detourKm) && access.detourKm > ON_ROUTE_DETOUR_KM) return 'off';
  if (!Number.isFinite(lineOffKm) || lineOffKm > ON_ROUTE_KM) return 'off';
  if (access?.verified && access.ok) return 'on';
  return 'unverified';
}

/**
 * Planlamaya girecek istasyonları ayır (istasyon nesneleri değişmez). lineOff(s) → km; keep: kullanıcının açıkça seçtiği (Git/ara durak/
 * değiştir/ekle) istasyonlar — onlar elenmez ama durumları işaretlenir. Dönüş: { status: { [id]: routeStatus }, offIds, blockedIds }.
 * offIds/blockedIds otomatik seçimde kullanılmaz (planlayıcının excludeIds'ine girer).
 */
export function splitByRoute(stations, lineOff, keep = new Set()) {
  const offIds = [];
  const blockedIds = [];
  const unverifiedIds = [];
  const status = {};
  for (const s of stations || []) {
    const st = routeStatus({ lineOffKm: lineOff(s), access: s.access });
    status[s.id] = st;
    if (!keep.has(s.id)) {
      if (st === 'off') offIds.push(s.id);
      else if (st === 'blocked') blockedIds.push(s.id);
      else if (st === 'unverified') unverifiedIds.push(s.id);
    }
  }
  return { status, offIds, blockedIds, unverifiedIds };
}

/**
 * v0.99.107 FAIL-CLOSED: otomatik planın kullanabileceği istasyonlar dışında kalanlar (planlayıcının excludeIds'i). Yalnız 'on' (yol ağıyla
 * gidiş yönünde doğrulanmış, rota üstü) otomatik seçilebilir: 'unverified' (sorgu yok / 429 / zaman aşımı / sağlayıcı yok) düz çizgi
 * yakınlığına bakılmaksızın OTOMATİK SEÇİLMEZ. keep (kullanıcının elle seçtikleri) splitByRoute'ta zaten listelere girmez.
 */
export const autoExclude = (split) => [...(split?.offIds || []), ...(split?.blockedIds || []), ...(split?.unverifiedIds || [])];

/** Plan metni: otomatik durak, erişim doğrulanamadığı/doğrulanmakta olduğu için seçilmedi (Türkçe kaynak; sözlükte çevrilir). */
export const ACCESS_PENDING_TEXT = 'Şarj durağı erişimi yol ağıyla doğrulanıyor…';
export const ACCESS_FAILED_TEXT = 'Şarj durağına erişim doğrulanamadı ({0}): güvenlik için otomatik durak seçilmedi. İstasyonlar listesinden durağı kendin seçebilir ya da biraz sonra yeniden planlayabilirsin.';

/** Ara nokta sorunu açıklamaları (stopVia.viaCheck reason → Türkçe kaynak metin). */
export const VIA_ISSUE_TEXT = {
  novia: 'Rota bu şarj durağına girmiyor (ara nokta değil)',
  noreach: 'Rota şarj durağının girişine ulaşmıyor',
  uturn: 'Durağa ancak geri dönüşle (karşı şerit) ulaşılıyor',
};

/**
 * Navigasyon başlatma kapısı (saf). plan.viaIssues: viaCheck sorunları; plan.routeStatus: istasyon durumu; plan.pinIds: elle seçilenler.
 * - Otomatik seçilmiş durakta tutarsızlık (rota durağa girmiyor / dönüşle) → block (başlatılmaz; durak değiştir ya da yeniden planla).
 * - Yalnız kullanıcının elle seçtiği durakta tutarsızlık ya da doğrulanmamış/karşı yön işareti → confirm (açık uyarı ve onayla başlar).
 * Dönüş: { block, confirm, names }.
 */
export function navGate(plan) {
  const fromKm = plan?.fromKm ?? 0;
  const ahead = (plan?.stops || []).filter((s) => s?.station && s.km > fromKm + 0.5);
  const via = new Set(plan?.viaIds || []);
  const pins = new Set((plan?.pinIds || []).filter((id) => !via.has(id))); // ara nokta rotası durakları zorunlu (pinIds) yapar: onlar elle seçim değildir
  const issues = (plan?.viaIssues || []).filter((x) => ahead.some((s) => s.station.id === x.id));
  const autoBad = issues.filter((x) => !pins.has(x.id));
  if (autoBad.length) return { block: true, confirm: false, names: autoBad.map((x) => x.name) };
  const flagged = ahead.filter((s) => pins.has(s.station.id) && (issues.some((x) => x.id === s.station.id) || ['unverified', 'blocked', 'off'].includes(plan?.routeStatus?.[s.station.id])));
  if (flagged.length) return { block: false, confirm: true, names: flagged.map((s) => s.station.name || '') };
  return { block: false, confirm: false, names: [] };
}

/**
 * Onaylı rota değişikliği için aday istasyonlar: rota üstü planı kurulamadığında, rota dışı ('off') istasyonlardan gevşek planın seçtiği
 * ilk durak önce, sonra sıralamada (ulaşılabilir: rankStations varış ≥ eşik) en iyiler; en çok max tane, tekrarsız.
 * relaxedStops: rota dışı istasyonlara izin verilen planın durakları; ranking: rankStations satırları; offIds: rota dışı kimlikler.
 */
export function altCandidates({ relaxedStops = [], ranking = [], offIds = [], fromKm = 0, max = MAX_ALTERNATIVES }) {
  const off = new Set(offIds);
  const out = [];
  const add = (s) => { if (s && off.has(s.id) && s.km > fromKm + 0.5 && !out.some((x) => x.id === s.id) && out.length < max) out.push(s); };
  relaxedStops.forEach((x) => add(x.station));
  ranking.forEach((r) => add(r.station));
  return out;
}

/**
 * Seçenek özeti (yalnızca sağlayıcının ve planın gerçek sonuçlarından; eksikse alan null kalır, uydurulmaz).
 * base: mevcut rotada kalan { km, min }; alt: seçenek rotası { km, min }; plan: seçenek rotasında planRoute sonucu; stationId: seçenek istasyonu.
 */
export function altSummary({ base, alt, plan, stationId }) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const stop = plan?.feasible ? plan.stops.find((s) => s.station.id === stationId) || null : null;
  const addKm = num(alt?.km) != null && num(base?.km) != null ? alt.km - base.km : null;
  const addMin = num(alt?.min) != null && num(base?.min) != null ? alt.min - base.min : null;
  return {
    feasible: !!plan?.feasible && !!stop,
    addKm, addMin,
    stopKm: stop ? num(stop.km) : null,
    arriveStopSoc: stop ? num(stop.arriveSoc) : null,
    leaveStopSoc: stop ? num(stop.leaveSoc) : null,
    chargeMin: stop ? num(stop.minutes) : null,
    stops: plan?.feasible ? plan.stops.length : null,
    arriveEndSoc: plan?.feasible ? num(plan.totals?.arriveSoc) : null,
    reason: plan?.feasible ? null : (plan?.reason || null),
  };
}

/**
 * Rota dışı seçenekleri hesapla (onay ÖNCESİ; mevcut plan/rota değişmez). Bağımlılıklar dışarıdan verilir:
 *  route(station) → sağlayıcı rotası (hata fırlatabilir; sağlayıcı yoksa fırlatır), evaluate(rt, station) → { alt: {km,min}, plan }.
 * Dönüş: { choices: [{ station, route, summary, provider }], failures: [{ station, error }], unavailable: bool }.
 * unavailable: hiçbir aday için rota alınamadı ya da aday yok — arayüz "seçenek yok" der, ölçü uydurmaz.
 */
export async function buildAlternatives({ candidates = [], base, route, evaluate }) {
  const choices = [];
  const failures = [];
  for (const station of candidates) {
    let rt;
    try {
      rt = await route(station);
      if (!rt || !Array.isArray(rt.coords) || rt.coords.length < 2) throw new Error('rota yanıtı boş');
    } catch (err) {
      failures.push({ station, error: err?.message || String(err) });
      continue;
    }
    let ev;
    try {
      ev = evaluate(rt, station);
    } catch (err) {
      failures.push({ station, error: err?.message || String(err) });
      continue;
    }
    const summary = altSummary({ base, alt: ev?.alt, plan: ev?.plan, stationId: station.id });
    if (!summary.feasible) { failures.push({ station, error: summary.reason || 'plan kurulamadı' }); continue; }
    choices.push({ station, route: rt, summary, provider: rt.routeMeta?.provider ?? null });
  }
  choices.sort((a, b) => (a.summary.addMin ?? Infinity) - (b.summary.addMin ?? Infinity));
  return { choices, failures, unavailable: !choices.length };
}

/**
 * Onay akışı: seçenekleri kullanıcıya sor, YALNIZCA açık onayda uygula. ask(result) → seçilen choice ya da null (İptal);
 * apply(choice) → yeni rotayı kur (Promise<boolean>). Seçenek yoksa ask yine çağrılır (arayüz "kullanılamıyor" der) ama apply çağrılmaz.
 * Dönüş: { applied: bool, cancelled: bool, choice }.
 */
export async function consentFlow({ result, ask, apply }) {
  const choice = await ask(result);
  if (!choice || result.unavailable || !result.choices.includes(choice)) return { applied: false, cancelled: true, choice: null };
  const ok = await apply(choice);
  return { applied: !!ok, cancelled: false, choice };
}

/** Durağın işareti: null (doğrulandı, rotada ya da bilinmiyor) | 'unverified' | 'off' | 'blocked'. status: plan.routeStatus. */
export const stopFlag = (stop, status) => {
  const st = status?.[stop?.station?.id];
  return st && st !== 'on' ? st : null;
};
