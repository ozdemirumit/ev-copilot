// Kamera yaşam döngüsü (camera.js): lens seçimi/sabitleme, önce kapat, geri dönüş, track ended/mute, yetenek ayarı.
// Kullanım: node scripts/test-camera-lifecycle.mjs
import { pickWideDevice, tuningPlan, exposureStep } from '../js/sensors/camera.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const d = (id, label, kind = 'videoinput') => ({ kind, deviceId: id, label });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// --- Lens seçimi ---
const iphone = [d('b', 'Back Camera'), d('dw', 'Back Dual Wide Camera'), d('tr', 'Back Triple Camera'), d('u', 'Back Ultra Wide Camera'), d('t', 'Back Telephoto Camera')];
ok('sanal çoklu kamera yerine fiziksel ultra geniş', pickWideDevice(iphone, 'b')?.deviceId === 'u');
ok('yalnızca sanal geniş varsa geçilmez (otomatik lens geçişi yapar)', pickWideDevice([d('b', 'Back Camera'), d('dw', 'Back Dual Wide Camera')], 'b') === null);
ok('ultra, düz "wide"dan önce gelir', pickWideDevice([d('w', 'Back Wide Camera'), d('u', 'Back Ultra Wide Camera')], 'b')?.deviceId === 'u');

// --- Yetenek planı ---
{
  const p = tuningPlan({ focusMode: ['manual', 'single-shot', 'continuous'], exposureMode: ['manual', 'continuous'] });
  ok('sürekli odak + pozlama seçilir', p.focusMode === 'continuous' && p.exposureMode === 'continuous');
}
ok('sürekli yoksa tek seferlik odak', tuningPlan({ focusMode: ['single-shot'] }).focusMode === 'single-shot');
ok('yetenek yoksa boş plan (iOS gibi)', Object.keys(tuningPlan({})).length === 0 && Object.keys(tuningPlan(undefined)).length === 0);

const range = { min: -2, max: 2, step: 0.5 };
ok('pozlama bir adım kısılır', exposureStep(0, range, -1) === -0.5);
ok('pozlama alt sınırda kalır', exposureStep(-2, range, -1) === -2);
ok('pozlama üst sınırda kalır', exposureStep(2, range, 1) === 2);
ok('yetenek yoksa null', exposureStep(0, null, -1) === null && exposureStep(0, { min: 0, max: 0 }, -1) === null);
ok('sıfır sinyal: değişmez', exposureStep(0.5, range, 0) === 0.5);

// --- Sahte tarayıcı ---
class FakeTrack extends EventTarget {
  constructor(deviceId, caps, log) { super(); this.deviceId = deviceId; this.caps = caps; this.log = log; this.readyState = 'live'; this.muted = false; this.applied = []; }
  stop() { this.readyState = 'ended'; this.log.push(`stop:${this.deviceId}`); }
  getSettings() { return { deviceId: this.deviceId, ...(this.applied.at(-1)?.advanced?.[0] || {}) }; }
  getCapabilities() { return this.caps; }
  async applyConstraints(c) { this.applied.push(c); }
  fire(type) { if (type === 'ended') this.readyState = 'ended'; if (type === 'mute') this.muted = true; if (type === 'unmute') this.muted = false; this.dispatchEvent(new Event(type)); }
}
function browser({ devices, caps = {}, failOn = () => false, defaultId = 'b' }) {
  const log = [];
  const tracks = [];
  let live = 0;
  let maxLive = 0;
  const md = {
    async getUserMedia(c) {
      const exact = c.video.deviceId?.exact;
      log.push(`open:${exact || 'facing'}`);
      if (failOn(exact || 'facing')) throw Object.assign(new Error('fail'), { name: 'NotReadableError' });
      const t = new FakeTrack(exact || defaultId, caps, log);
      const origStop = t.stop.bind(t);
      t.stop = () => { if (t.readyState === 'live') live--; origStop(); };
      live++; maxLive = Math.max(maxLive, live);
      tracks.push(t);
      return { getTracks: () => [t], getVideoTracks: () => [t] };
    },
    async enumerateDevices() { log.push('enumerate'); return devices; },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: md }, configurable: true });
  return { log, tracks, get maxLive() { return maxLive; }, get live() { return live; } };
}
const video = () => ({ dataset: {}, style: {}, srcObject: null, paused: false, play: async () => {} });
const fresh = (tag) => import(`../js/sensors/camera.js?${tag}`);

const WIDE = [d('b', 'Back Camera'), d('u', 'Back Ultra Wide Camera')];
{
  const b = browser({ devices: WIDE });
  const cam = await fresh('a');
  const v = video();
  await cam.startCamera(v);
  ok('ultra geniş açılır', b.log.join() === 'open:facing,enumerate,stop:b,open:u');
  ok('eski akış yenisi açılmadan kapatılır (aynı anda 1 akış)', b.maxLive === 1);
  ok('tanılama seçilen kamerayı bildirir', cam.cameraDiag().label === 'Back Ultra Wide Camera' && cam.cameraDiag().method === 'label');
  const n = b.log.length;
  cam.stopCamera(v);
  await cam.startCamera(v);
  ok('oturumda sabit: yeniden açılışta aynı lens, keşif yok', b.log.slice(n).join() === 'stop:u,open:u');
  cam.stopCamera(v);
}
{
  const b = browser({ devices: WIDE, failOn: (id) => id === 'u' });
  const cam = await fresh('b');
  await cam.startCamera(video());
  ok('ultra geniş açılamazsa önceki kameraya döner', b.log.join() === 'open:facing,enumerate,stop:b,open:u,open:b');
  ok('geri dönüş raporlanır', cam.cameraDiag().method === 'fallback' && /NotReadableError/.test(cam.cameraDiag().note));
  ok('çalışan akış var', cam.isCameraLive());
  cam.stopCamera(video());
}
{
  const b = browser({ devices: WIDE, failOn: (id) => id !== 'facing' });
  const cam = await fresh('c');
  await cam.startCamera(video());
  ok('kimlikle geri dönüş de olmazsa facingMode ile açılır', b.log.join() === 'open:facing,enumerate,stop:b,open:u,open:b,open:facing' && cam.isCameraLive());
  cam.stopCamera(video());
}
{
  browser({ devices: WIDE, failOn: () => true });
  const cam = await fresh('d');
  let threw = false;
  try { await cam.startCamera(video()); } catch { threw = true; }
  ok('hiçbir kamera yoksa hata fırlatır', threw && !cam.isCameraLive());
}
{
  const b = browser({ devices: [d('b', 'camera2 0, facing back')] });
  const cam = await fresh('e');
  await cam.startCamera(video());
  ok('ultra geniş yoksa uygun arka kamerada kalır', b.log.join() === 'open:facing,enumerate' && cam.cameraDiag().method === 'facing');
  ok('etiket yetersizliği raporlanır', /ultra/i.test(cam.cameraDiag().note));
  cam.stopCamera(video());
}
{
  const b = browser({ devices: WIDE });
  const cam = await fresh('f');
  const v = video();
  await Promise.all([cam.startCamera(v), cam.startCamera(v)]);
  ok('eşzamanlı start tek akış açar', b.log.filter((l) => l.startsWith('open')).length === 2 && b.live === 1);
  cam.stopCamera(v);
  ok('stop tüm akışları kapatır', b.live === 0);
}
{
  const caps = { focusMode: ['continuous'], exposureMode: ['continuous'], exposureCompensation: { min: -2, max: 2, step: 1 } };
  const b = browser({ devices: [d('b', 'Back Camera')], caps });
  const cam = await fresh('g');
  await cam.startCamera(video());
  await tick();
  const t = b.tracks.at(-1);
  ok('odak/pozlama uygulanır', t.applied.at(-1)?.advanced?.[0]?.focusMode === 'continuous');
  ok('uygulananlar tanılamada', cam.cameraDiag().applied.includes('focusMode'));
  ok('applyConstraints çözünürlüğü korur', t.applied.at(-1)?.width?.ideal === 1280);
  await cam.nudgeExposure(-1, 100000);
  ok('pozlama kısılır', t.applied.at(-1).advanced[0].exposureCompensation === -1);
  const n = t.applied.length;
  await cam.nudgeExposure(-1, 100500);
  ok('pozlama hız sınırlı', t.applied.length === n);
  cam.stopCamera(video());
}
{
  const caps = { focusMode: ['continuous'], zoom: { min: 0.5, max: 8, step: 0.1 } };
  const b = browser({ devices: [d('b', 'Back Camera')], caps });
  const cam = await fresh('g2');
  const v = video();
  await cam.startCamera(v);
  await cam.setZoom(v, 0.5);
  const adv = b.tracks[0].applied.at(-1).advanced[0];
  ok('zoom uygulanırken odak ayarı kaybolmaz', adv.zoom === 0.5 && adv.focusMode === 'continuous');
  cam.stopCamera(v);
}
{
  const b = browser({ devices: [d('b', 'Back Camera')] });
  const cam = await fresh('h');
  await cam.startCamera(video());
  await cam.nudgeExposure(-1, 100000);
  ok('yetenek yoksa pozlama denenmez', b.tracks[0].applied.length === 0);
  ok('desteklenmeyenler tanılamada', cam.cameraDiag().unsupported.includes('exposureCompensation'));
  cam.stopCamera(video());
}
{
  const b = browser({ devices: [d('b', 'Back Camera')] });
  const cam = await fresh('i');
  cam.setRecoveryDelays([5, 5, 5]);
  const events = [];
  cam.onCameraStatus((s) => events.push(s));
  const v = video();
  await cam.startCamera(v);
  const first = b.tracks[0];
  first.fire('mute');
  ok('mute: kamera canlı sayılmaz', !cam.isCameraLive() && cam.cameraDiag().health === 'muted');
  first.fire('unmute');
  ok('unmute: canlıya döner', cam.isCameraLive());
  first.fire('ended');
  ok('ended: canlı değil', !cam.isCameraLive());
  await tick(40);
  ok('ended: aynı kamera yeniden açılır', b.tracks.length === 2 && cam.isCameraLive() && v.srcObject.getVideoTracks()[0] === b.tracks[1]);
  ok('yeniden açılış bildirilir', events.includes('recovered'));
  cam.stopCamera(v);
  await tick(20);
  ok('stop sonrası kurtarma yok', b.tracks.length === 2);
}
{
  let failing = false;
  const b = browser({ devices: [d('b', 'Back Camera')], failOn: () => failing });
  const cam = await fresh('j');
  cam.setRecoveryDelays([1, 1, 1]);
  const events = [];
  cam.onCameraStatus((s) => events.push(s));
  await cam.startCamera(video());
  failing = true;
  b.tracks[0].fire('ended');
  await tick(50);
  ok('kurtarma başarısızsa sınırlı deneme sonrası lost', events.includes('lost') && b.log.filter((l) => l.startsWith('open')).length <= 1 + 3 * 2);
  ok('lost sonrası canlı değil', !cam.isCameraLive() && cam.cameraDiag().health === 'lost');
  cam.stopCamera(video());
}
{
  const b = browser({ devices: [d('b', 'Back Camera')] });
  const cam = await fresh('k');
  cam.setRecoveryDelays([1, 1, 1]);
  cam.setMuteRecoverMs(5);
  await cam.startCamera(video());
  b.tracks[0].fire('mute');
  await tick(40);
  ok('uzun süren mute yeniden açılışı tetikler', b.tracks.length === 2 && cam.isCameraLive());
  cam.stopCamera(video());
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
