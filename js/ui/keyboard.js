// Ekran klavyesi: iOS'ta klavye yerleşim görünümünü küçültmez, yalnızca görsel görünümü (visualViewport) küçültür; sabit konumlu sayfa
// (main) klavyenin ARKASINDA kalır. Klavye yüksekliği --kb değişkenine yazılır, sayfanın alt kenarı onun üstüne alınır (CSS: body.kbd-open main).
// Rota alanlarına yazarken (body.typing) form kompaktlaşır (pil kartı ve Planla/Git gizlenir) ve odaklı alan sayfanın üstüne kaydırılır;
// böylece alan ve altındaki öneri listesi klavyenin üstündeki alana sığar.

export const KB_MIN = 120; // bundan küçük görünüm farkı klavye sayılmaz (adres çubuğu vb.)

/** Klavye yüksekliği (px): yerleşim yüksekliği − görsel yükseklik − görsel üst kayma; küçükse 0. */
export function keyboardInset({ innerHeight, vvHeight, vvOffsetTop = 0 }) {
  const kb = Math.round(innerHeight - vvHeight - vvOffsetTop);
  return kb >= KB_MIN ? kb : 0;
}

/** Kaydırılabilir gövdede (sheet-body) alanın üst kenarının hedef scrollTop değeri. */
export function revealTop({ fieldTop, bodyTop, scrollTop, pad = 6 }) {
  return Math.max(0, Math.round(fieldTop - bodyTop + scrollTop - pad));
}

const TEXT_SEL = '#tab-route input[type=text], #tab-route input[type=search]';

export function initKeyboard() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const apply = () => {
    const kb = vv ? keyboardInset({ innerHeight: window.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop }) : 0;
    root.style.setProperty('--kb', kb + 'px');
    document.body.classList.toggle('kbd-open', kb > 0);
  };
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  apply();

  const reveal = (input) => {
    const body = input.closest('.sheet-body');
    if (!body) return;
    const field = input.closest('.field') || input;
    body.scrollTo({ top: revealTop({ fieldTop: field.getBoundingClientRect().top, bodyTop: body.getBoundingClientRect().top, scrollTop: body.scrollTop }), behavior: 'smooth' });
  };
  document.addEventListener('focusin', (e) => {
    if (!e.target.matches?.(TEXT_SEL)) return;
    document.body.classList.add('typing');
    setTimeout(() => reveal(e.target), 120); // form kompaktlaştıktan sonra (klavye animasyonu sürerken de çalışır; görünüm değişince bir kez daha)
    setTimeout(() => { if (document.activeElement === e.target) reveal(e.target); }, 450);
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!document.activeElement?.matches?.(TEXT_SEL)) document.body.classList.remove('typing');
  }, 120));
  vv?.addEventListener('resize', () => { const a = document.activeElement; if (a?.matches?.(TEXT_SEL)) setTimeout(() => reveal(a), 60); }); // klavye açılınca/kapanınca alan yeniden hizalanır
}
