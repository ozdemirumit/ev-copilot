// Kamera yaşam döngüsü: en geniş açılı arka fiziksel kamerayı seçer ve oturum boyunca sabitler, donanım zoom'unu en genişte sabitler,
// odak/pozlamayı destekleniyorsa ayarlar,
// track ended/mute durumlarını izler. Web API lens seçimini yalnızca cihaz etiketiyle mümkün kılar; sınırlamalar cameraDiag() ile raporlanır.
let stream = null;
let track = null;
let hw = null; // cihaz donanım zoom'u destekliyorsa { min, max }; açılışta alt sınır (en geniş) uygulanır
let videoEl = null;

let gen = 0; // stopCamera/startCamera ile artar: eski işlemler sonuç yazmaz
let opening = null;
let pinned = null; // bu oturumda seçilen kamera (deviceId)
let health = 'off'; // off | live | muted | ended | recovering | lost
let info = { label: '', method: '', note: '' };
let desired = {}; // applyConstraints her çağrıda tümünü yeniden yazdığından ayarlar birlikte tutulur
let expRange = null;
let lastNudge = 0;
let applied = [];
let unsupported = [];

let recoverDelays = [1000, 3000, 8000];
let muteRecoverMs = 8000;
let attempts = 0;
let recoverTimer = null;
let muteTimer = null;
let recovering = false;
let waitVisible = false;
let visibilityBound = false;

const listeners = new Set();
const BASE = { width: { ideal: 1280 }, height: { ideal: 720 } };
const FACING = { video: { facingMode: { ideal: 'environment' }, ...BASE }, audio: false };
const exactDevice = (id) => ({ video: { deviceId: { exact: id }, ...BASE }, audio: false });
const EXPOSURE_COOLDOWN_MS = 10000;
const CONTROLS = ['focusMode', 'exposureMode', 'exposureCompensation', 'zoom'];

const BACK = /back|rear|environment|arka/i;
const WIDE = /ultra|wide|geni[sş]|0[.,]5/i;
const ULTRA = /ultra|0[.,]5/i;
const TELE = /tele|zoom|macro/i;
const VIRTUAL = /dual|triple|quad|multi|logical/i; // sanal çoklu kamera: işletim sistemi lensi kendisi değiştirir

const isHidden = () => typeof document !== 'undefined' && document.hidden === true;
const stopStream = (s) => s?.getTracks().forEach((t) => t.stop());
const open = (constraints) => navigator.mediaDevices.getUserMedia(constraints);

/**
 * Arka kameralar arasından en geniş açılı fiziksel kamerayı seç (etiketten: "Ultra Wide", "0.5x" vb.). Etiket yoksa ya da böyle bir kamera yoksa null.
 * Zaten kullanılan kameraysa da null (yeniden açmaya gerek yok).
 */
export function pickWideDevice(devices, currentId) {
  const cams = (devices || []).filter((d) => d && d.kind === 'videoinput' && d.deviceId && d.label);
  const back = cams.filter((d) => BACK.test(d.label));
  const wide = (back.length ? back : cams).filter((d) => WIDE.test(d.label) && !TELE.test(d.label) && !VIRTUAL.test(d.label));
  const pick = wide.find((d) => ULTRA.test(d.label)) || wide[0] || null;
  return pick && pick.deviceId !== currentId ? pick : null;
}

/** getCapabilities çıktısından uygulanacak odak/pozlama kipleri (desteklenmeyen hiçbir şey istenmez). */
export function tuningPlan(caps) {
  const plan = {};
  if (caps?.focusMode?.includes('continuous')) plan.focusMode = 'continuous';
  else if (caps?.focusMode?.includes('single-shot')) plan.focusMode = 'single-shot';
  if (caps?.exposureMode?.includes('continuous')) plan.exposureMode = 'continuous';
  const z = caps?.zoom;
  if (z && Number.isFinite(z.min) && z.max > z.min) plan.zoom = z.min; // sabit en geniş görüş: donanım zoom'unun alt sınırı (kullanıcı ayarı yok)
  return plan;
}

/**
 * Eski sürümlerdeki kayıtlı yakınlaştırmadan (camZoom) kalan ROI'leri sabit en geniş görüşe uyarlar. Saf işlev.
 * - Dijital yakınlaştırma (donanım zoom'u yok) kesin eşlenir: görünen alan ortadan 1/z küçülüyordu → x' = 0,5 + (x − 0,5)/z, w' = w/z.
 * - Donanım zoom'u ile kaydedilmiş değer optik görüşü değiştirdiğinden güvenli eşlenemez: ROI korunur, yeniden ayar gerekir.
 * Dönüş: { rois, changed, recalibrate }.
 */
export function legacyZoomRoi(savedZoom, rois, { hardware = false, hwMin = 1 } = {}) {
  const z = Number(savedZoom);
  const same = { rois, changed: false, recalibrate: false };
  if (savedZoom == null || !Number.isFinite(z)) return same;
  if (hardware) return { ...same, recalibrate: z > hwMin + 1e-6 };
  if (!(z > 1 + 1e-6)) return same;
  const map = (r) => {
    if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) return r;
    const w = r.w / z, h = r.h / z;
    const x = Math.min(1 - w, Math.max(0, 0.5 + (r.x - 0.5) / z));
    const y = Math.min(1 - h, Math.max(0, 0.5 + (r.y - 0.5) / z));
    return { ...r, x, y, w, h };
  };
  const out = {};
  for (const k of Object.keys(rois || {})) out[k] = map(rois[k]);
  return { rois: out, changed: true, recalibrate: false };
}

/** Pozlama telafisinde bir adım; aralık yoksa null. */
export function exposureStep(current, range, signal) {
  if (!range || !(range.max > range.min)) return null;
  const step = range.step > 0 ? range.step : 0.5;
  return Math.min(range.max, Math.max(range.min, current + Math.sign(signal) * step));
}

async function applyDesired(t = track) {
  if (!t || !Object.keys(desired).length) return;
  await t.applyConstraints({ ...BASE, advanced: [{ ...desired }] });
}

function reportApplied(t) {
  const s = t.getSettings?.() || {};
  applied = Object.keys(desired).filter((k) => s[k] === desired[k]);
}

function setHealth(next) {
  if (health === next) return;
  health = next;
  emit(next);
}
function emit(event) {
  listeners.forEach((fn) => { try { fn(event); } catch (err) { console.warn('Kamera dinleyicisi hata verdi:', err); } });
}

/** Kamera durum olayları: live | muted | ended | recovering | recovered | lost | off. Dönüş: aboneliği kaldıran işlev. */
export function onCameraStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Şu an gerçek kare akıyor mu? OCR donmuş/eski kareyi başarılı okuma saymasın diye. */
export const isCameraLive = () => health === 'live' && track?.readyState === 'live' && !track.muted;

/** Tanılama: seçilen kamera, seçim yöntemi, tarayıcı/işletim sistemi sınırlamaları. */
export const cameraDiag = () => ({ ...info, health, applied: [...applied], unsupported: [...unsupported] });

/** Yalnızca testler için: kurtarma beklemeleri. */
export function setRecoveryDelays(list) { recoverDelays = list; }
export function setMuteRecoverMs(ms) { muteRecoverMs = ms; }

function noWideNote(devices) {
  const cams = devices.filter((d) => d?.kind === 'videoinput');
  if (cams.some((d) => !d.label)) return 'Kamera etiketleri alınamadı; ultra geniş belirlenemedi, varsayılan arka kamera kullanılıyor';
  return 'Etiketlerde ultra geniş kamera yok; uygun arka kamera kullanılıyor (tarayıcı lens açısını bildirmez)';
}

/** Kamera akışı edinir. Sabit kamera varsa doğrudan onu açar; yoksa seçer. Geçişte eski akış önce kapatılır, olmazsa önceki kameraya dönülür. */
async function acquire() {
  if (pinned) {
    try {
      return { stream: await open(exactDevice(pinned)), reused: true };
    } catch (err) {
      info = { ...info, note: `Sabit kamera açılamadı (${err.name}); yeniden seçiliyor` };
      pinned = null;
    }
  }

  const first = await open(FACING);
  const cur = first.getVideoTracks()[0]?.getSettings?.().deviceId || null;
  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { /* liste alınamadı: ilk akışla devam */ }
  const labelOf = (id) => devices.find((d) => d?.deviceId === id)?.label || '';
  const wide = pickWideDevice(devices, cur);
  if (!wide) {
    const already = devices.some((d) => d?.deviceId === cur && ULTRA.test(d.label || ''));
    return { stream: first, deviceId: cur, label: labelOf(cur), method: already ? 'label' : 'facing', note: already ? '' : noWideNote(devices) };
  }

  stopStream(first); // birçok telefon iki kamerayı aynı anda açamaz: önce eskisini kapat
  try {
    return { stream: await open(exactDevice(wide.deviceId)), deviceId: wide.deviceId, label: wide.label, method: 'label', note: '' };
  } catch (err) {
    let back = null;
    if (cur) { try { back = await open(exactDevice(cur)); } catch { /* facingMode ile denenecek */ } }
    back ||= await open(FACING); // bu da olmazsa hata çağırana gider
    return { stream: back, deviceId: cur, label: labelOf(cur), method: 'fallback', note: `Ultra geniş açılamadı (${err.name}); önceki arka kameraya dönüldü` };
  }
}

function tune(t) {
  const caps = t.getCapabilities?.() || {};
  desired = tuningPlan(caps);
  const r = caps.exposureCompensation;
  expRange = r && r.max > r.min ? { min: r.min, max: r.max, step: r.step } : null;
  lastNudge = 0;
  applied = [];
  unsupported = CONTROLS.filter((k) => caps[k] == null);
  if (!Object.keys(desired).length) return;
  applyDesired(t).then(() => reportApplied(t)).catch((err) => {
    if (!('zoom' in desired)) return console.warn('Kamera ayarı uygulanamadı:', err);
    // Zoom reddedildiyse odak/pozlama kaybolmasın: zoom'suz (varsayılan 1×) yeniden dene
    delete desired.zoom;
    const msg = 'En geniş zoom uygulanamadı; varsayılan 1× görüş';
    if (!info.note?.includes(msg)) info = { ...info, note: [info.note, msg].filter(Boolean).join(' · ') };
    if (!Object.keys(desired).length) return;
    applyDesired(t).then(() => reportApplied(t)).catch((e) => console.warn('Kamera ayarı uygulanamadı:', e));
  });
}

function watch(t) {
  t.addEventListener?.('ended', () => { if (t === track) onEnded(); });
  t.addEventListener?.('mute', () => { if (t === track) onMuted(); });
  t.addEventListener?.('unmute', () => { if (t === track) onUnmuted(); });
}

function onEnded() {
  clearTimeout(muteTimer);
  setHealth('ended');
  scheduleRecover();
}
function armMuteRecover() {
  clearTimeout(muteTimer);
  const my = gen;
  muteTimer = setTimeout(() => { if (my === gen && health === 'muted') scheduleRecover(0); }, muteRecoverMs);
}
function onMuted() {
  setHealth('muted');
  if (!isHidden()) armMuteRecover(); // arka plandayken mute normaldir: kamerayı yeniden açma
}
function onUnmuted() {
  clearTimeout(muteTimer);
  attempts = 0;
  setHealth('live');
}

function scheduleRecover(delay) {
  if (recovering || recoverTimer) return;
  if (isHidden()) { waitVisible = true; return; }
  if (attempts >= recoverDelays.length) {
    setHealth('lost');
    return;
  }
  const my = gen;
  recoverTimer = setTimeout(() => { recoverTimer = null; if (my === gen) recover(my); }, delay ?? recoverDelays[attempts]);
  attempts++;
}

async function recover(my) {
  recovering = true;
  setHealth('recovering');
  stopStream(stream); // aynı kamerayı tekrar açmadan önce eskisini bırak
  try {
    const got = await acquire();
    recovering = false;
    if (my !== gen) { stopStream(got.stream); return; }
    await attach(got, videoEl);
    attempts = 0;
    emit('recovered');
  } catch (err) {
    recovering = false;
    if (my !== gen) return;
    info = { ...info, note: `Yeniden açılamadı (${err.name})` };
    health = 'ended';
    scheduleRecover();
  }
}

/**
 * Ön plana dönüş (visibilitychange, pageshow — bfcache —, focus): duraklatılmış video sürdürülür ve arka planda kaçırılmış iz
 * olayları (iOS'ta ended/unmute bazen gelmez) iz durumundan yeniden senkronlanır; aksi halde health 'muted' kalır ve OCR kare almaz.
 */
function onVisibility() {
  if (isHidden() || !stream) return;
  if (videoEl?.paused) videoEl.play?.().catch(() => {});
  if (waitVisible) { waitVisible = false; scheduleRecover(0); return; }
  if (recovering || recoverTimer) return;
  if (track?.readyState === 'ended' && health !== 'ended') onEnded(); // ended olayı kaçırıldı
  else if (health === 'muted' && track && !track.muted) onUnmuted(); // unmute olayı kaçırıldı
  else if (health === 'muted') armMuteRecover();
}

async function attach(got, video) {
  stream = got.stream;
  videoEl = video;
  track = stream.getVideoTracks()[0] || null;
  if (!got.reused) {
    pinned = got.deviceId || track?.getSettings?.().deviceId || null;
    info = { label: got.label || track?.label || '', method: got.method, note: got.note };
  }
  const z = track?.getCapabilities?.().zoom;
  hw = z && z.max > z.min ? { min: z.min, max: z.max } : null;
  if (track) { tune(track); watch(track); }
  resetView(video);
  video.srcObject = stream;
  await video.play().catch(() => {});
  setHealth(track?.muted ? 'muted' : 'live');
}

async function doStart(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera API yok (HTTPS gerekli olabilir)');
  const my = ++gen;
  clearRecovery();
  stopStream(stream);
  const got = await acquire();
  if (my !== gen) { stopStream(got.stream); throw new Error('Kamera açılışı iptal edildi'); }
  if (!visibilityBound && typeof document !== 'undefined' && document.addEventListener) {
    visibilityBound = true;
    document.addEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pageshow', onVisibility);
      window.addEventListener('focus', onVisibility);
    }
  }
  await attach(got, video);
}

/** Arka kamerayı video elemanına bağlar. Varsa en geniş açılı arka kamera seçilir ve oturum boyunca sabit kalır. Güvenli bağlam (HTTPS/localhost) gerekir. */
export function startCamera(video) {
  opening ||= doStart(video).finally(() => { opening = null; });
  return opening;
}

function clearRecovery() {
  clearTimeout(recoverTimer);
  clearTimeout(muteTimer);
  recoverTimer = null;
  muteTimer = null;
  recovering = false;
  waitVisible = false;
  attempts = 0;
}

export function stopCamera(video) {
  gen++;
  clearRecovery();
  stopStream(stream);
  stream = null;
  track = null;
  hw = null;
  desired = {};
  videoEl = null;
  video.srcObject = null;
  resetView(video);
  setHealth('off');
}

/** OCR'ın ölçtüğü parlama/karanlığa göre pozlama telafisini bir adım değiştirir; hız sınırlıdır, desteklenmiyorsa hiçbir şey yapmaz. */
export async function nudgeExposure(signal, now = Date.now()) {
  if (!signal || !track || !expRange || now - lastNudge < EXPOSURE_COOLDOWN_MS) return;
  const current = desired.exposureCompensation ?? track.getSettings?.().exposureCompensation ?? 0;
  const next = exposureStep(current, expRange, signal);
  if (next == null || next === current) return;
  lastNudge = now;
  desired.exposureCompensation = next;
  const t = track;
  try {
    await applyDesired(t);
    reportApplied(t);
  } catch (err) {
    console.warn('Pozlama ayarlanamadı:', err);
  }
}

/** Dijital (CSS) yakınlaştırma kullanılmaz: OCR kırpması her zaman ölçeksiz görüntüyle eşlenir (sensors/preprocess.js `data-dz`). */
function resetView(video) {
  video.dataset.dz = '1';
  video.style.transform = '';
}

/** Donanım zoom'u: { hardware, min, max, applied } — sabit en geniş değer; kullanıcı ayarı yoktur. */
export function zoomInfo() {
  return { hardware: !!hw, min: hw?.min ?? 1, max: hw?.max ?? 1, applied: desired.zoom ?? 1 };
}
