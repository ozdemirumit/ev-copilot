// İsteğe bağlı anahtarlar (OpenChargeMap, Mapbox) ve önbellek durumu. Anahtarlar yalnızca bu cihazın LocalStorage'ında durur.
import { load, save } from '../utils/storage.js';
import { testOcm } from '../osm/chargers.js';
import { MB_VALID } from '../mapbox/api.js';
import { testMapbox } from '../mapbox/test.js';
import { toast } from './toast.js';
import { cacheStats, clearCache } from '../utils/cache.js';
import { testProxy } from '../net/proxy.js';
import { tr } from '../i18n/index.js';

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

  // Ara sunucu (isteğe bağlı): adres ve erişim kodu bu telefonda saklanır, anahtarlar sunucuda kalır
  const pUrl = $('proxy-url');
  const pCode = $('proxy-code');
  const pOut = $('proxy-out');
  pUrl.value = load('proxyUrl', '');
  pCode.value = load('proxyCode', '');
  $('proxy-test').addEventListener('click', async () => {
    const u = pUrl.value.trim();
    if (u && !/^https:\/\//i.test(u)) return toast('Adres https:// ile başlamalı');
    if (u && !pCode.value.trim()) return toast('Önce erişim kodunu gir');
    pOut.textContent = 'Sınanıyor…';
    const r = await testProxy(u, pCode.value);
    if (!u) pOut.textContent = 'Ara sunucu kapalı: uygulama servislere doğrudan gider.';
    else if (!r.ok) pOut.textContent = `⚠️ ${tr(r.text)}`;
    else pOut.replaceChildren(...[
      '✅ Sunucu çalışıyor',
      r.caps.mapbox ? 'Mapbox: sunucuda' : 'Mapbox: sunucuda yok',
      r.caps.ocm ? 'OpenChargeMap: sunucuda' : 'OpenChargeMap: sunucuda yok',
      'Overpass: ortak önbellek',
    ].map((t) => Object.assign(document.createElement('div'), { textContent: t })));
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
