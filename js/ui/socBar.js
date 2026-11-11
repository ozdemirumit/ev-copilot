// Harita üstündeki pil + menzil hapı: dokununca elle ayar penceresi açılır (yatay sürgü, ±1, klavye).
// Değer yolda kendiliğinden düşer (physics/socEstimate.js); kamera okuyunca o değer geçerli olur. Sürgü bırakılınca açık plan yeniden hesaplanır.
import { getState, patch, subscribe, effective } from '../state.js';
import { setManual, manualLocked, socSource, ocrAgeMs, DEFAULT_SOC } from '../physics/socEstimate.js';
import { setStartSoc } from '../routing/controller.js';
import { t, tr } from '../i18n/index.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);

const LABEL = { sim: 'Test', live: 'Canlı', stale: 'Eski', manual: 'Elle', estimate: 'Tahmin', default: 'Varsayılan', none: '—' };
const LOCK_TEXT = 'Pil kameradan canlı okunuyor: elle ayar gerekmez (kamera durursa sürgü açılır).';

function noteFor(src, locked) {
  if (src === 'sim') return 'Test Modu: pil Test sekmesindeki değerdir.';
  if (locked) return LOCK_TEXT;
  if (src === 'default') return t('Pil bilgisi yok: %{0} varsayılıyor. Sürgüyle ayarla ya da kamerayla okut.', DEFAULT_SOC);
  if (src === 'manual') return 'Elle girildi: yol alındıkça tüketim modeliyle düşer, kamera okuyunca düzelir.';
  const age = ocrAgeMs();
  // Kamera açık ama pil doğrulanamıyor: güvenli yedek (son doğrulanan değerden tüketimle düşen tahmin) ve ne kadar eski olduğu açıkça yazılır
  if (src === 'estimate' && getState('system').ocr && age != null) return t('Kamera açık ama pil {0} dakikadır doğrulanamadı: son doğrulanan değerden tahmin ediliyor.', Math.max(1, Math.round(age / 60000)));
  if (src === 'estimate') return 'Son bilinen değerden tahmin ediliyor. Sürgüyle düzeltebilirsin.';
  if (src === 'stale' && age != null) return t('Kamera okuması eski ({0} sn önce doğrulandı): son doğrulanan değer gösteriliyor.', Math.round(age / 5000) * 5);
  if (src === 'stale') return 'Kamera okuması eski: son okunan değer gösteriliyor. Sürgüyle düzeltebilirsin.';
  return 'Son okunan değer.';
}

export function initSocBar() {
  const track = $('socbar-track');
  const fill = $('socbar-fill');
  const thumb = $('socbar-thumb');
  const val = $('socbar-val');
  const src = $('socbar-src');
  const bar = $('socbar');
  const level = $('socbar-level');
  const sheet = $('soc-sheet');
  const mapSlider = $('map-soc');
  let mapDrag = false;
  let drag = false;
  let commitTimer = null;

  const paint = () => {
    const e = effective();
    const v = e.soc;
    const pct = v == null ? 0 : Math.min(100, Math.max(0, v));
    const shown = v == null ? '--' : String(Math.round(v));
    const sim = e.source === 'sim';
    const source = sim ? 'sim' : socSource();
    const label = LABEL[source] ?? '—';
    const locked = !sim && manualLocked();
    // Toplam menzil: mevcut pille %0'a kadar tahmini km (seçili araç + menzil motoru). Eşik piline kadar menzil Menzil sekmesinde.
    const eng = getState('engine');
    const total = eng.totalRangeKm != null && v != null ? Math.max(0, Math.round(eng.totalRangeKm)) : null;
    const km = total == null ? '--' : String(total);
    const low = v != null && v < getState('nav').lowSoc;

    // Tüketim: ölçülen varsa o, yoksa model tahmini (hangisi olduğu başlıkta yazar)
    const cons = eng.kwh100Measured ?? eng.kwh100Est;
    $('socbar-cons').textContent = cons == null ? '--' : cons.toFixed(1);
    // İki tüketim: ilki şimdi (ölçülen ya da model tahmini; rotada önümüzdeki 25 km), ikincisi menzilin dayandığı ortalama (rota profili ya da düz zemin)
    const avg = eng.rangeKwh100;
    const route = eng.rangeSrc === 'route';
    $('socbar-cons-lbl').textContent = tr('şimdi');
    $('socbar-cons2').textContent = avg == null ? '--' : avg.toFixed(1);
    $('socbar-cons2-lbl').textContent = tr(route ? 'rota' : 'düz');
    $('socbar-consbox').title = tr(eng.kwh100Measured != null ? 'Şimdi: son mesafe tüketimi (ölçülen)' : 'Şimdi: tahmini tüketim (model, rotada önümüzdeki 25 km)') + '. ' + tr(route ? 'Rota: menzilin dayandığı rota ortalaması' : 'Düz: menzilin dayandığı düz zemin tüketimi');
    // Eşik piline (varışta minimum pil) kadar menzil: toplam menzilin yanında
    const thr = eng.rangeKm != null && v != null ? Math.max(0, Math.round(eng.rangeKm)) : null;
    $('socbar-thr-lbl').textContent = tr('eşiğe');
    $('socbar-thr-km').textContent = thr == null ? '--' : String(thr);
    $('socbar-thr').title = t('%{0} eşik piline kadar menzil: {1} km', getState('route').minArrivalSoc, thr == null ? '--' : thr);
    $('soc-sheet-thr').textContent = thr == null ? '' : t('%{0} eşik piline kadar {1} km', getState('route').minArrivalSoc, thr);
    if (!mapDrag) mapSlider.value = String(Math.round(v ?? DEFAULT_SOC));
    mapSlider.disabled = locked; // kamera canlı okurken elle ayar kapalı (pencere sürgüsüyle aynı kural)

    val.textContent = shown;
    src.textContent = label;
    $('socbar-range').textContent = km;
    level.style.width = pct + '%';
    bar.dataset.src = source;
    bar.classList.toggle('low', low);
    const dotCls = sim ? 'ind sim' : source === 'live' ? 'ind on' : source === 'default' || source === 'none' ? 'ind off' : 'ind';
    $('socbar-dot').className = dotCls;
    const nhDot = $('nh-soc-dot');
    if (nhDot) nhDot.className = dotCls;
    bar.setAttribute('aria-label', t('Pil %{0}, tahmini menzil {1} km, kaynak: {2}. Elle ayarlamak için dokun.', shown, km, label));
    $('socbar-rangebox').title = 'Tahmini toplam menzil (%0\'a kadar)' + (eng.rangeKm != null ? `; %${getState('route').minArrivalSoc} eşik piline kadar ${Math.max(0, Math.round(eng.rangeKm))} km` : '');

    // Pencere
    fill.style.width = pct + '%';
    thumb.style.left = pct + '%';
    track.setAttribute('aria-valuenow', String(Math.round(pct)));
    track.setAttribute('aria-valuetext', t('Pil %{0}, tahmini menzil {1} km', shown, km));
    track.setAttribute('aria-disabled', String(locked));
    track.classList.toggle('locked', locked);
    $('soc-sheet-minus').disabled = locked;
    $('soc-sheet-plus').disabled = locked;
    $('soc-sheet-val').textContent = shown;
    $('soc-sheet-range').textContent = km;
    const chip = $('soc-sheet-src');
    chip.textContent = label;
    chip.dataset.src = source;
    const note = noteFor(source, locked);
    const noteEl = $('soc-sheet-note');
    if (noteEl.dataset.src !== note) { noteEl.dataset.src = note; noteEl.textContent = note; } // 3 sn'lik yenileme aynı metni okutmasın
  };

  let lastToast = 0;
  const blocked = () => {
    if (getState('sim').enabled || !manualLocked()) return false;
    if (Date.now() - lastToast > 8000) { lastToast = Date.now(); toast('Pil kameradan canlı okunuyor: elle ayar gerekmez'); }
    return true;
  };
  const apply = (v) => {
    const next = Math.min(100, Math.max(0, Math.round(v)));
    if (getState('sim').enabled) patch('sim', { soc: next });
    else setManual(next);
    return next;
  };
  // Açık planın yeniden hesabı (ağ çağrısı yok): sürükleme bırakılınca ya da adımlar bitince bir kez
  const commit = (delay = 250) => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => { const v = effective().soc; if (v != null) setStartSoc(Math.round(v)); }, delay);
  };
  const step = (d) => {
    if (blocked()) return;
    apply(Math.round(effective().soc ?? DEFAULT_SOC) + d);
    commit();
  };
  const setFromX = (clientX) => {
    const r = track.getBoundingClientRect();
    apply(((clientX - r.left) / r.width) * 100);
  };

  track.addEventListener('pointerdown', (e) => {
    if (blocked()) return;
    drag = true;
    track.setPointerCapture(e.pointerId);
    setFromX(e.clientX);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => { if (drag) setFromX(e.clientX); });
  ['pointerup', 'pointercancel'].forEach((ev) => track.addEventListener(ev, () => { if (drag) { drag = false; commit(0); } }));
  track.addEventListener('keydown', (e) => {
    const cur = Math.round(effective().soc ?? DEFAULT_SOC);
    const target = { ArrowUp: cur + 1, ArrowRight: cur + 1, ArrowDown: cur - 1, ArrowLeft: cur - 1, PageUp: cur + 10, PageDown: cur - 10, Home: 0, End: 100 }[e.key];
    if (target == null) return;
    e.preventDefault();
    if (blocked()) return;
    apply(target);
    commit();
  });
  // Harita üstü küçük sürgü: pencere sürgüsüyle aynı yoldan yazar
  mapSlider.addEventListener('input', () => {
    mapDrag = true;
    apply(Number(mapSlider.value));
  });
  mapSlider.addEventListener('change', () => { mapDrag = false; commit(0); });
  $('ne-soc-btn').addEventListener('click', () => bar.click()); // navigasyonda hap gizli: aynı pencere
  $('soc-sheet-minus').addEventListener('click', () => step(-1));
  $('soc-sheet-plus').addEventListener('click', () => step(1));

  // Pencere: değer açma/kapamada değişmez; odak açılınca sürgüye, kapanınca (tarayıcı) hapa döner
  const close = () => sheet.close();
  bar.addEventListener('click', () => { paint(); sheet.showModal(); track.focus(); });
  $('soc-sheet-x').addEventListener('click', close);
  $('soc-sheet-done').addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); }); // arka plana dokununca

  subscribe(['live', 'sim', 'engine', 'nav', 'ocr', 'system'], paint);
  setInterval(paint, 3000); // kamera okuması eskiyince (canlı → eski) değer değişmese de güncelle
  paint();
}
