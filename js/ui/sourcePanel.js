// Veri kaynağı seçimi: Google veya Alternatif (açık kaynak). Seçim tüm veri türlerini birlikte değiştirir (providers/index.js).
// Hazır olmayan kaynak görünür ama seçilemez. Google'a özgü anahtar kartı yalnızca Google seçiliyken gösterilir.
import { SOURCES, getSource, setSource } from '../providers/index.js';
import { load, save } from '../utils/storage.js';
import { testOcm } from '../osm/chargers.js';
import { toast } from './toast.js';

const NOTES = {
  google: 'Google: harita, rota (canlı trafikle), istasyonlar ve doluluk, arama, hava, rakım ve yol hız limiti. Google anahtarı gerekir; kullandıkça ücretlenebilir (aşağıdaki sayaç).',
  osm: 'Alternatif: OpenStreetMap tabanlı açık kaynak servisler (harita OpenFreeMap, rota Valhalla, istasyon Overpass, hava ve rakım Open-Meteo/Valhalla, arama Photon). Anahtar gerekmez; canlı trafik ve istasyon doluluğu yoktur. Çevrimdışı harita sonraki sürümde.',
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
  // Kaynağa özgü metinler (data-g / data-osm) ve yalnızca Google'a ait bölümler (.g-only, CSS ile gizlenir)
  document.body.dataset.source = current;
  document.querySelectorAll('[data-osm]').forEach((e) => { e.textContent = current === 'google' ? e.dataset.g : e.dataset.osm; });
  const btn = document.getElementById('nh-limitbtn');
  if (btn) btn.title = current === 'google' ? 'Yol hız limiti kontrolü (ücretli)' : 'Yol hız limiti kontrolü';

  // Alternatif kaynak ayarları: OpenChargeMap anahtarı (yalnızca bu cihazda)
  const box = document.getElementById('osm-settings');
  box.classList.toggle('hidden', current !== 'osm');
  const key = document.getElementById('ocm-key');
  const out = document.getElementById('ocm-out');
  key.value = load('ocmKey', '');
  key.addEventListener('change', () => {
    const v = key.value.trim();
    if (v && !/^[A-Za-z0-9-]{16,64}$/.test(v)) { toast('Anahtar biçimi geçersiz'); return; }
    save('ocmKey', v);
  });
  document.getElementById('ocm-test').addEventListener('click', async () => {
    key.dispatchEvent(new Event('change'));
    out.textContent = 'Sınanıyor…';
    const r = await testOcm();
    out.textContent = `${r.ok ? '✅' : '⚠️'} OpenChargeMap: ${r.text}`;
  });
}
