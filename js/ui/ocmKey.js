// OpenChargeMap anahtarı (isteğe bağlı: istasyon kapsamını artırır) ve önbellek durumu. Anahtar yalnızca bu cihazın LocalStorage'ında durur.
import { load, save } from '../utils/storage.js';
import { testOcm } from '../osm/chargers.js';
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
