import { getState } from '../state.js';
import { load, save } from '../utils/storage.js';
import { createTokenReader } from '../sensors/tokenOcr.js';
import { toast } from './toast.js';

// Token / API Key alanlarını kamerayla EKRANDAKİ METİNDEN okur (OCR, cihazın içinde; değer üçüncü taraf siteye yazılmaz).
// Boş bir alana dokununca kamera açılır. Okunan değer onay ekranında düzenlenebilir.
const OCR_EVERY_MS = 1100;
const STABLE_READS = 2; // aynı değer art arda bu kadar okununca kabul (OCR hatasına karşı)
const VALID = /^[A-Za-z0-9_-]{8,128}$/;

// Okunabilen alanlar: target → { alan kimliği, ekranda görünen ad }
const TARGETS = {
  token: { input: 'abrp-token', name: 'ABRP User Token' },
  apikey: { input: 'abrp-apikey', name: 'ABRP API Key' },
  ocm: { input: 'ocm-key', name: 'OpenChargeMap API Key' },
};

const $ = (id) => document.getElementById(id);

export function initTokenScanner() {
  const dlg = $('qr-dialog');
  const autoToggle = $('scan-on-focus');
  let stream = null;
  let seq = 0; // yeniden taramada eski döngüleri iptal eder
  let found = null;
  let reader = null;
  let suppressUntil = 0;
  let target = 'token';

  function cleanup() {
    seq++;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    $('qr-video').srcObject = null;
    $('qr-confirm').classList.add('hidden');
    reader?.terminate();
    reader = null;
    found = null;
  }
  dlg.addEventListener('close', () => {
    cleanup();
    suppressUntil = Date.now() + 1500; // kapanınca odak alana döner; kamerayı yeniden açmasın
  });
  $('qr-close').addEventListener('click', () => dlg.close());

  async function startScan(which = target) {
    target = which;
    const { name } = TARGETS[target];
    if (getState('system').camera) return toast('Önce Kamera sekmesindeki kamerayı durdur');
    if (!navigator.mediaDevices?.getUserMedia) return toast('Kamera API yok (HTTPS gerekli olabilir)');
    cleanup();
    const my = ++seq;
    $('qr-title').textContent = `${name} oku`;
    if (!dlg.open) dlg.showModal();
    $('qr-hint').textContent = `${name} yazılı olduğu ekranı kamerayla kutunun içine sığdır, metin net ve büyük görünsün.`;
    const status = $('qr-status');
    status.textContent = 'Kamera açılıyor…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
    } catch (err) {
      status.textContent = 'Kamera açılamadı: ' + (err.message || err.name);
      return;
    }
    if (my !== seq) { stream.getTracks().forEach((t) => t.stop()); return; }
    const video = $('qr-video');
    video.srcObject = stream;
    await video.play().catch(() => {});

    const alive = () => my === seq && stream;
    let lastUuid = null;
    let count = 0;
    try {
      status.textContent = 'OCR motoru hazırlanıyor… (ilk seferde iner)';
      reader = await createTokenReader();
      if (!alive()) { reader?.terminate(); return; }
      status.textContent = 'Metin aranıyor…';
      while (alive()) {
        const r = await reader.read(video, $('qr-view'));
        if (!alive()) return;
        if (r?.uuid) {
          count = r.uuid === lastUuid ? count + 1 : 1;
          lastUuid = r.uuid;
          status.textContent = `Okunuyor… ${count}/${STABLE_READS}`;
          if (count >= STABLE_READS) return onFound(r.uuid, my);
        } else {
          lastUuid = null;
          count = 0;
          status.textContent = 'Metin aranıyor…';
        }
        await new Promise((res) => setTimeout(res, OCR_EVERY_MS));
      }
    } catch (err) {
      if (alive()) status.textContent = 'Okuma başarısız: ' + err.message;
    }
  }

  function onFound(value, my) {
    if (my !== seq) return;
    found = value;
    seq++; // döngüyü durdur
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    $('qr-video').srcObject = null;
    reader?.terminate();
    reader = null;
    $('qr-status').textContent = 'Okundu.';
    $('qr-found-label').textContent = `Okunan ${TARGETS[target].name}`;
    $('qr-found').value = value;
    $('qr-confirm').classList.remove('hidden');
  }

  $('btn-qr-scan').addEventListener('click', () => startScan('token'));
  $('btn-ocm-scan').addEventListener('click', () => startScan('ocm'));
  $('qr-retry').addEventListener('click', () => startScan(target));
  $('qr-manual').addEventListener('click', () => {
    const input = $(TARGETS[target].input);
    dlg.close();
    suppressUntil = Date.now() + 5000; // elle yazarken kamera yeniden açılmasın
    input.focus();
  });
  $('qr-save').addEventListener('click', () => {
    const value = $('qr-found').value.trim(); // kullanıcı düzeltmiş olabilir
    if (!found) return;
    if (!VALID.test(value)) return toast('Geçersiz değer: yalnızca harf, rakam ve tire');
    const el = $(TARGETS[target].input);
    el.value = value;
    el.dispatchEvent(new Event('change')); // ilgili panel kaydeder (abrpPanel / stationsView)
    dlg.close();
    toast(`${TARGETS[target].name} kaydedildi`);
  });

  // ---------- Boş alana dokununca kamerayı aç ----------
  autoToggle.checked = load('scanOnFocus', true);
  autoToggle.addEventListener('change', () => save('scanOnFocus', autoToggle.checked));
  Object.entries(TARGETS).forEach(([which, { input }]) => {
    $(input).addEventListener('focus', () => {
      // Yalnızca boş alanda: dolu alana dokunmak (düzeltmek/yapıştırmak) kamerayı açmaz.
      if (!autoToggle.checked || dlg.open || $(input).value.trim() || Date.now() < suppressUntil) return;
      startScan(which);
    });
  });
}
