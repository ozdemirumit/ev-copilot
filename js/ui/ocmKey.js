// İsteğe bağlı anahtarlar (OpenChargeMap, Mapbox) ve önbellek durumu. Anahtarlar yalnızca bu cihazın LocalStorage'ında durur.
import { load, save } from '../utils/storage.js';
import { testOcm } from '../osm/chargers.js';
import { MB_VALID } from '../mapbox/api.js';
import { testMapbox } from '../mapbox/test.js';
import { toast } from './toast.js';
import { cacheStats, clearCache } from '../utils/cache.js';

const $ = (id) => document.getElementById(id);
const VALID = /^[A-Za-z0-9-]{16,64}$/;

export function initOcmKey() {
  const input = $('ocm-key');
  const out = $('ocm-out');
  input.value = load('ocmKey', '');

  /** Anahtarı kaydet. Geçersizse false. */
  function commit() {
    const v = input.value.trim();
    if (v && !VALID.test(v)) { toast('Anahtar biçimi geçersiz'); return false; }
    save('ocmKey', v);
    return true;
  }
  input.addEventListener('change', commit);

  $('ocm-test').addEventListener('click', async () => {
    if (!commit()) return;
    out.textContent = 'Sınanıyor…';
    const r = await testOcm();
    out.textContent = `${r.ok ? '✅' : '⚠️'} OpenChargeMap: ${r.text}`;
  });

  // Mapbox anahtarı (herkese açık "pk." anahtarı)
  const mb = $('mb-key');
  const mbOut = $('mb-out');
  mb.value = load('mbKey', '');
  function commitMb() {
    const v = mb.value.trim();
    if (v.startsWith('sk.')) { toast('Bu gizli (sk.) anahtar: yalnızca herkese açık pk. anahtarı girilir'); return false; }
    if (v && !MB_VALID.test(v)) { toast('Mapbox anahtarı biçimi geçersiz (pk. ile başlamalı)'); return false; }
    save('mbKey', v);
    return true;
  }
  mb.addEventListener('change', commitMb);
  $('mb-test').addEventListener('click', async () => {
    if (!mb.value.trim()) return toast('Önce anahtarı gir');
    if (!commitMb()) return;
    mbOut.textContent = 'Sınanıyor…';
    const res = await testMapbox();
    mbOut.replaceChildren(...res.map((r) => {
      const p = document.createElement('div');
      p.textContent = `${r.ok ? '✅' : '⚠️'} ${r.name}: ${r.text}`;
      return p;
    }));
  });

  // Önbellek durumu: isabet = sunucuya gidilmeyen çağrı
  const info = $('cache-info');
  const paintCache = () => {
    const c = cacheStats();
    info.textContent = `Önbellek: ${c.entries} kayıt · ${c.hits} çağrı sunucuya gitmedi, ${c.misses} gitti`;
  };
  $('cache-clear').addEventListener('click', () => { clearCache(); paintCache(); toast('Önbellek temizlendi'); });
  setInterval(paintCache, 5000);
  paintCache();
}
