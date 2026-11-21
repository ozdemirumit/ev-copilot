// Saha testi kaydı (v0.99.120; SAF: ağ/DOM/depolama/zaman okumaz, zaman parametreyle gelir). Sürüş sırasında yalnız SAYILAR toplanır:
// OCR okuma/ret/okunamadı, GPS taze süre oranı, navigasyon süresi, sesli uyarı sayıları (tür bazında), kamera kopması, yeniden planlama, hata sayıları.
// KONUM, adres, konuşma metni ve ham OCR değeri TUTULMAZ. Hata iletilerinden URL, e-posta ve koordinat çıkarılır. Rapor kullanıcının cihazında üretilir;
// dışarı yalnız kullanıcı eylemiyle (kopyala/indir/paylaş) çıkar. Kayıt kapalıyken hiçbir şey toplanmaz.
export const REPORT_SCHEMA = 'evrf-field-report/1';
export const MAX_ERROR_KINDS = 12;
const MSG_MAX = 160;

/** Hata iletisini kısaltıp gizlilik açısından temizler (URL, e-posta, koordinat çıkar). Boş/bozuk → '(boş)'. */
export function sanitizeMessage(m) {
  let s = typeof m === 'string' ? m : (m && typeof m.message === 'string' ? m.message : '');
  s = s.replace(/https?:\/\/\S+/gi, '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '').replace(/-?\d{1,3}\.\d{3,}(\s*,\s*-?\d{1,3}\.\d{3,})?/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, MSG_MAX) : '(boş)';
}

/** Sesli uyarı anahtarından TÜR (anahtar koordinat/ad taşıyabilir: yalnız tür döner). */
export function spokenKind(key) {
  const k = typeof key === 'string' ? key : '';
  if (/^road:/.test(k)) return 'road';
  if (/^c\d/.test(k)) return 'camera';
  if (/^v\d/.test(k)) return 'curve';
  if (/^g\d/.test(k)) return 'grade';
  if (/^traffic[@?]/.test(k)) return 'traffic';
  if (/^rain@/.test(k)) return 'rain';
  if (k === 'speed') return 'speed';
  if (k === 'reroute' || k === 'rerouted') return 'reroute';
  if (/^stop:/.test(k)) return 'stop';
  if (/^nav\d/.test(k)) return 'maneuver';
  if (k === 'navstart' || k === 'arrived' || k === 'voicetest') return 'nav';
  return 'other';
}

/** Kullanıcı-ajanı dizesinden yalnız aile (tam dize raporda yer almaz). */
export function deviceFamily(ua) {
  const s = String(ua || '');
  if (/Android/i.test(s)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(s)) return 'iOS';
  if (/Windows/i.test(s)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(s)) return 'Mac';
  if (/Linux|X11/i.test(s)) return 'Linux';
  return 'bilinmiyor';
}

const fresh = () => ({
  startedAt: null, endedAt: null,
  ocr: { reads: 0, ok: 0, rejected: 0, rejectedByReason: {}, unreadable: 0, errors: 0, gapSum: 0, gapCount: 0, gapMax: 0 },
  gps: { msByState: {}, transitions: 0 },
  nav: { sessions: 0, ms: 0 },
  spoken: { total: 0, byKind: {} },
  camera: { recovered: 0, lost: 0 },
  plans: 0,
  errors: { total: 0, byMessage: {} },
});

const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const cleanCounts = (o, limit = 40) => { const out = {}; if (!isObj(o)) return out; for (const [k, v] of Object.entries(o).slice(0, limit)) out[String(k).slice(0, MSG_MAX)] = num(v); return out; };

export function createFieldLog() {
  let d = fresh();
  let on = false;
  let prevOcr = null; // taban: kayıt başlarken sayaçlar sayılmaz
  let lastOkAt = null;
  let gpsCur = null; // { state, since }
  let navSince = null;
  let planId;
  let hasPlan = false;
  let lastAt = 0;

  const touch = (now) => { if (typeof now === 'number' && Number.isFinite(now)) lastAt = Math.max(lastAt, now); };
  const closeGps = (now) => { if (gpsCur) { d.gps.msByState[gpsCur.state] = (d.gps.msByState[gpsCur.state] || 0) + Math.max(0, now - gpsCur.since); gpsCur.since = now; } };

  const api = {
    active: () => on,
    start(now) { d = fresh(); d.startedAt = now; prevOcr = null; lastOkAt = null; gpsCur = null; navSince = null; hasPlan = false; planId = undefined; on = true; touch(now); },
    stop(now) { if (!on) return; closeGps(now); if (navSince != null) { d.nav.ms += Math.max(0, now - navSince); navSince = null; } d.endedAt = now; gpsCur = null; on = false; touch(now); },
    reset(now) { const was = on; api.start(now); on = was; },
    /** Kapalı kayıt (load sonrası) kaldığı yerden sürer; sayaçlar korunur, açık aralıklar yeniden başlar. */
    resume(now) { if (on) return; on = true; d.endedAt = null; touch(now); },

    /** state.ocr dilimi her değiştiğinde. */
    ocr(o, now) {
      if (!on || !isObj(o)) return;
      touch(now);
      const cur = { readCount: num(o.readCount), readAt: num(o.readAt), rejectedAt: num(o.rejected?.at), status: o.status };
      if (prevOcr) {
        const x = d.ocr;
        if (cur.readCount > prevOcr.readCount) x.reads += cur.readCount - prevOcr.readCount;
        if (cur.readAt && cur.readAt !== prevOcr.readAt) {
          x.ok++;
          if (lastOkAt != null) { const gap = Math.max(0, now - lastOkAt); x.gapSum += gap; x.gapCount++; x.gapMax = Math.max(x.gapMax, gap); }
          lastOkAt = now;
        }
        if (cur.rejectedAt && cur.rejectedAt !== prevOcr.rejectedAt) {
          x.rejected++;
          const r = typeof o.rejected.reason === 'string' && o.rejected.reason ? o.rejected.reason.slice(0, 40) : 'unknown';
          x.rejectedByReason[r] = (x.rejectedByReason[r] || 0) + 1;
        }
        if (cur.status !== prevOcr.status) {
          if (cur.status === 'unreadable') x.unreadable++;
          else if (cur.status === 'error') x.errors++;
        }
      }
      prevOcr = cur;
    },
    gps(state, now) {
      if (!on || typeof state !== 'string') return;
      touch(now);
      if (gpsCur && gpsCur.state === state) return;
      closeGps(now);
      if (gpsCur) d.gps.transitions++;
      gpsCur = { state, since: now };
    },
    nav(active, now) {
      if (!on) return;
      touch(now);
      if (active && navSince == null) { d.nav.sessions++; navSince = now; } else if (!active && navSince != null) { d.nav.ms += Math.max(0, now - navSince); navSince = null; }
    },
    spoken(key, now) {
      if (!on) return;
      touch(now);
      const k = spokenKind(key);
      d.spoken.total++;
      d.spoken.byKind[k] = (d.spoken.byKind[k] || 0) + 1;
    },
    error(message, now) {
      if (!on) return;
      touch(now);
      d.errors.total++;
      const m = sanitizeMessage(message);
      const by = d.errors.byMessage;
      if (m in by || Object.keys(by).length < MAX_ERROR_KINDS) by[m] = (by[m] || 0) + 1;
    },
    camera(event, now) {
      if (!on) return;
      touch(now);
      if (event === 'recovered') d.camera.recovered++;
      else if (event === 'lost') d.camera.lost++;
    },
    plan(id, now) {
      if (!on) return;
      touch(now);
      if (!hasPlan) { hasPlan = true; planId = id; return; }
      if (id !== planId) { planId = id; d.plans++; }
    },

    /** Özet (düz nesne). Açık aralıklar (GPS durumu, navigasyon oturumu) now'a kadar hesaba katılır. */
    snapshot(now) {
      const ms = { ...d.gps.msByState };
      if (gpsCur) ms[gpsCur.state] = (ms[gpsCur.state] || 0) + Math.max(0, now - gpsCur.since);
      const total = Object.values(ms).reduce((a, b) => a + b, 0);
      const x = d.ocr;
      const top = Object.entries(d.errors.byMessage).sort((a, b) => b[1] - a[1]).slice(0, MAX_ERROR_KINDS).map(([message, count]) => ({ message, count }));
      const end = d.endedAt ?? now;
      return {
        v: 1, startedAt: d.startedAt, endedAt: d.endedAt,
        durationMs: d.startedAt == null ? 0 : Math.max(0, end - d.startedAt),
        nav: { sessions: d.nav.sessions, ms: d.nav.ms + (navSince != null ? Math.max(0, now - navSince) : 0) },
        ocr: {
          reads: x.reads, ok: x.ok, okRate: x.reads ? +(x.ok / x.reads).toFixed(4) : null, rejected: x.rejected, rejectedByReason: { ...x.rejectedByReason },
          unreadable: x.unreadable, errors: x.errors, maxGapMs: x.gapMax, meanGapMs: x.gapCount ? Math.round(x.gapSum / x.gapCount) : 0,
        },
        gps: { msByState: ms, freshRate: total ? +((ms.ok || 0) / total).toFixed(4) : null, transitions: d.gps.transitions },
        spoken: { total: d.spoken.total, byKind: { ...d.spoken.byKind } },
        camera: { ...d.camera },
        plans: d.plans,
        errors: { total: d.errors.total, top },
      };
    },

    /** Saklanacak küçük düz nesne (yalnız sayaçlar). */
    save(now = lastAt) {
      const s = api.snapshot(now);
      return { v: 1, updatedAt: lastAt, startedAt: s.startedAt, endedAt: s.endedAt, durationMs: s.durationMs, nav: s.nav, ocr: { ...d.ocr, rejectedByReason: { ...d.ocr.rejectedByReason } }, gps: { msByState: s.gps.msByState, transitions: d.gps.transitions }, spoken: s.spoken, camera: s.camera, plans: s.plans, errors: { total: d.errors.total, byMessage: { ...d.errors.byMessage } } };
    },
    /** Saklanmış özeti geri yükler (kayıt etkin olmaz; kullanıcı yeniden başlatır). Geçersizse false. */
    load(obj, now) {
      if (!isObj(obj) || obj.v !== 1 || !isObj(obj.ocr) || !isObj(obj.gps) || !isObj(obj.nav) || !isObj(obj.spoken) || !isObj(obj.errors)) return false;
      const n = fresh();
      n.startedAt = typeof obj.startedAt === 'number' ? obj.startedAt : null;
      n.endedAt = typeof obj.endedAt === 'number' ? obj.endedAt : (typeof now === 'number' ? now : null);
      const o = obj.ocr;
      n.ocr = { reads: num(o.reads), ok: num(o.ok), rejected: num(o.rejected), rejectedByReason: cleanCounts(o.rejectedByReason), unreadable: num(o.unreadable), errors: num(o.errors), gapSum: num(o.gapSum), gapCount: num(o.gapCount), gapMax: num(o.gapMax) };
      n.gps = { msByState: cleanCounts(obj.gps.msByState), transitions: num(obj.gps.transitions) };
      n.nav = { sessions: num(obj.nav.sessions), ms: num(obj.nav.ms) };
      n.spoken = { total: num(obj.spoken.total), byKind: cleanCounts(obj.spoken.byKind) };
      n.camera = { recovered: num(obj.camera?.recovered), lost: num(obj.camera?.lost) };
      n.plans = num(obj.plans);
      n.errors = { total: num(obj.errors.total), byMessage: cleanCounts(obj.errors.byMessage, MAX_ERROR_KINDS) };
      touch(num(obj.updatedAt));
      d = n; on = false; prevOcr = null; lastOkAt = null; gpsCur = null; navSince = null; hasPlan = false;
      return true;
    },
  };
  return api;
}

const REASONS = { range: 'aralık dışı', 'low-score': 'güven düşük', verifying: 'doğrulanıyor', jump: 'sıçrama', fragment: 'hane kaybı', recovering: 'geri dönüş', truncated: 'hane eksik', 'extra-digit': 'fazla hane', flat: 'düz görüntü', glare: 'parlama', 'low-confidence': 'motor güveni', 'no-consensus': 'uyuşmadı', 'no-digits': 'rakam yok', confirming: 'teyit' };
const KINDS = { road: 'yol olayı', camera: 'hız kamerası', curve: 'sert viraj', grade: 'dik eğim', traffic: 'trafik', rain: 'yağış', speed: 'hız', reroute: 'yeniden rota', stop: 'şarj durağı', maneuver: 'manevra', nav: 'navigasyon', other: 'diğer' };
const dur = (ms) => (ms >= 3600e3 ? `${Math.floor(ms / 3600e3)} sa ${Math.round((ms % 3600e3) / 60e3)} dk` : ms >= 60e3 ? `${Math.round(ms / 60e3)} dk` : `${Math.round(ms / 1000)} sn`);
const pct = (r) => (r == null ? '—' : `%${Math.round(r * 100)}`);

/** Okunabilir Türkçe rapor (düz metin). meta: { version, platform, standalone, at }. */
export function formatReport(s, meta = {}) {
  const lines = [];
  lines.push('EV Route Finder — saha testi özeti');
  lines.push(`Sürüm ${meta.version || '?'} · ${meta.platform || 'bilinmiyor'} · ${meta.standalone ? 'uygulama (PWA)' : 'tarayıcı'}${meta.at ? ` · ${meta.at}` : ''}`);
  lines.push(`Kayıt süresi ${dur(s.durationMs)} (navigasyon ${dur(s.nav.ms)}, ${s.nav.sessions} oturum)`);
  const o = s.ocr;
  const rej = Object.entries(o.rejectedByReason).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${REASONS[r] || r} ×${n}`).join(', ');
  lines.push(`OCR: ${o.reads} okuma, ${o.ok} geçerli (${pct(o.okRate)}); reddedilen ${o.rejected}${rej ? ` (${rej})` : ''}; okunamadı ${o.unreadable}; hata ${o.errors}; geçerli okumalar arası ortalama ${dur(o.meanGapMs)}, en uzun ${dur(o.maxGapMs)}`);
  const states = Object.entries(s.gps.msByState).map(([k, v]) => `${k} ${dur(v)}`).join(', ');
  lines.push(`GPS: taze ${pct(s.gps.freshRate)}, ${s.gps.transitions} durum değişimi${states ? ` (${states})` : ''}`);
  const sp = Object.entries(s.spoken.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${KINDS[k] || k} ${n}`).join(', ');
  lines.push(`Sesli uyarı: ${s.spoken.total}${sp ? ` (${sp})` : ''}`);
  lines.push(`Kamera: ${s.camera.recovered} yeniden açılma, ${s.camera.lost} kayıp · yeniden planlama: ${s.plans}`);
  lines.push(`Hata: ${s.errors.total}${s.errors.top.length ? ' — ' + s.errors.top.slice(0, 5).map((e) => `${e.message} ×${e.count}`).join('; ') : ''}`);
  lines.push('Konum, adres ve konuşma metni raporda yer almaz.');
  return lines.join('\n');
}

/** JSON rapor (tam kullanıcı-ajanı yok; yalnız aile). */
export function reportJson(s, meta = {}) {
  return { schema: REPORT_SCHEMA, meta: { version: String(meta.version || '?'), platform: String(meta.platform || 'bilinmiyor'), standalone: !!meta.standalone, at: meta.at || null }, summary: s };
}
