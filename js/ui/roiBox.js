import { getState, patch, subscribe } from '../state.js';
import { save } from '../utils/storage.js';
import { boxStyle, screenToBaseDelta, getView, onView } from './camView.js';

const MIN = 0.06; // ROI'nin minimum boyutu (çerçevenin oranı)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function persist() {
  const o = getState('ocr');
  save('camera', {
    roi: o.roi, roiSpeed: o.roiSpeed, speedOn: o.speedOn, engine: o.engine,
    contrast: o.contrast, threshold: o.threshold, useThreshold: o.useThreshold,
    autoSkew: o.autoSkew, rot: o.rot, shear: o.shear,
  });
}

/** Kamera çerçevesi üzerinde sürüklenebilir + köşeden boyutlandırılabilir ROI kutusu. Konum 0..1 oran olarak saklanır (görünümden bağımsız: sahne oranı).
 *  Önizleme yakınlaştırılmışsa (js/ui/camView.js) kutu görüntüyle birlikte çizilir; sürükleme farkı yakınlaştırmaya bölünerek taban oranına çevrilir. */
function makeRoi(stage, box, handle, key) {
  const paint = () => {
    const s = boxStyle(getView(), getState('ocr')[key]);
    box.style.left = s.left;
    box.style.top = s.top;
    box.style.width = s.width;
    box.style.height = s.height;
  };
  const commit = (roi) => { patch('ocr', { [key]: roi }); paint(); };

  function drag(startEvent, apply) {
    const rect = stage.getBoundingClientRect();
    const start = { ...getState('ocr')[key] };
    const px = startEvent.clientX;
    const py = startEvent.clientY;
    const target = startEvent.currentTarget;
    target.setPointerCapture?.(startEvent.pointerId);

    const move = (e) => {
      const d = screenToBaseDelta(getView(), (e.clientX - px) / rect.width, (e.clientY - py) / rect.height);
      apply(start, d.dx, d.dy);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      persist();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  box.addEventListener('pointerdown', (e) => {
    if (e.target === handle) return;
    e.preventDefault();
    drag(e, (s, dx, dy) => commit({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) }));
  });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    drag(e, (s, dx, dy) => commit({ ...s, w: clamp(s.w + dx, MIN, 1 - s.x), h: clamp(s.h + dy, MIN, 1 - s.y) }));
  });

  paint();
  onView(paint); // yakınlaştırma/kaydırma değişince kutu görüntüyle birlikte yeniden çizilir
  subscribe('ocr', paint); // kutu dışarıdan değişirse de (eski yakınlaştırma kaydının uyarlanması) güncel görünsün
}

export function initRoiBox() {
  const stage = document.getElementById('cam-stage');
  makeRoi(stage, document.getElementById('roi'), document.getElementById('roi-handle'), 'roi');
  makeRoi(stage, document.getElementById('roi-speed'), document.getElementById('roi-speed-handle'), 'roiSpeed');

  const speedBox = document.getElementById('roi-speed');
  const paintSpeedBox = () => speedBox.classList.toggle('hidden', !getState('ocr').speedOn);
  subscribe('ocr', paintSpeedBox);
  paintSpeedBox();
}

export { persist as persistCamera };
