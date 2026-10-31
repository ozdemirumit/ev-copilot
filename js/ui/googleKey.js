// Google API anahtarı alanı: kaydet, hangi API'lerin çalıştığını sına. Anahtar yalnızca bu cihazın LocalStorage'ında durur.
import { load, save } from '../utils/storage.js';
import { googleKey } from '../google/loader.js';
import { testGoogleKey } from '../google/api.js';
import { bootMap } from './mapView.js';
import { toast } from './toast.js';
import { cacheStats, clearCache } from '../utils/cache.js';

const $ = (id) => document.getElementById(id);
const VALID = /^[A-Za-z0-9_-]{20,80}$/;

export function initGoogleKey() {
  const input = $('g-key');
  const out = $('g-test-out');
  input.value = load('gKey', '');

  /** Anahtarı kaydet. Maps script'i eski anahtarla yüklendiyse sayfayı yenile. Geçersizse false. */
  function commit() {
    const v = input.value.trim();
    if (v && !VALID.test(v)) { toast('Anahtar biçimi geçersiz: yalnızca harf, rakam, tire ve alt çizgi'); return false; }
    const old = googleKey();
    save('gKey', v);
    if (old && old !== v && window.google?.maps) { location.reload(); return false; }
    bootMap();
    return true;
  }

  input.addEventListener('change', commit);

  // Önbellek durumu: isabet = Google'a gidilmeyen çağrı (kota/fatura tasarrufu)
  const info = $('cache-info');
  const paintCache = () => {
    const c = cacheStats();
    info.textContent = `Önbellek: ${c.entries} kayıt · ${c.hits} çağrı Google'a gitmedi, ${c.misses} gitti`;
  };
  $('cache-clear').addEventListener('click', () => { clearCache(); paintCache(); toast('Önbellek temizlendi'); });
  setInterval(paintCache, 5000);
  paintCache();

  $('btn-gkey-test').addEventListener('click', async () => {
    if (!input.value.trim()) return toast('Önce anahtarı gir');
    if (!commit()) return;
    out.textContent = 'Sınanıyor…';
    const res = await testGoogleKey();
    out.replaceChildren(...res.map((r) => {
      const p = document.createElement('div');
      p.textContent = `${r.ok ? '✅' : '⚠️'} ${r.name}: ${r.text}`;
      return p;
    }));
  });
}
