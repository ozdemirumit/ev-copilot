// Veri kaynağı seçimi: Google veya Alternatif (açık kaynak). Seçim tüm veri türlerini birlikte değiştirir (providers/index.js).
// Hazır olmayan kaynak görünür ama seçilemez. Google'a özgü anahtar kartı yalnızca Google seçiliyken gösterilir.
import { SOURCES, getSource, setSource } from '../providers/index.js';

const NOTES = {
  google: 'Google: harita, rota (canlı trafikle), istasyonlar ve doluluk, arama, hava, rakım ve yol hız limiti. Google anahtarı gerekir; kullandıkça ücretlenebilir (aşağıdaki sayaç).',
  osm: 'Alternatif: OpenStreetMap tabanlı açık kaynak servisler. Anahtar gerekmez; canlı trafik ve istasyon doluluğu yoktur. Ülke haritası cihaza indirilirse çevrimdışı çalışır.',
};

export function initSourcePanel() {
  const seg = document.getElementById('source-seg');
  const note = document.getElementById('source-note');
  const current = getSource();
  seg.replaceChildren(...SOURCES.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(s.id === current));
    b.classList.toggle('sel', s.id === current);
    b.disabled = !s.ready;
    b.textContent = s.ready ? s.label : `${s.label} (hazırlanıyor)`;
    b.addEventListener('click', () => { if (s.id !== getSource()) setSource(s.id); });
    return b;
  }));
  note.textContent = NOTES[current];
  document.getElementById('g-card').classList.toggle('hidden', current !== 'google');
}
