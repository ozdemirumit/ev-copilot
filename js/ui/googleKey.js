// Google API anahtarı alanı: kaydet, hangi API'lerin çalıştığını sına. Anahtar yalnızca bu cihazın LocalStorage'ında durur.
import { load, save } from '../utils/storage.js';
import { googleKey } from '../google/loader.js';
import { testGoogleKey } from '../google/api.js';
import { bootMap } from './mapView.js';
import { toast } from './toast.js';
import { cacheStats, clearCache } from '../utils/cache.js';
import { usageSummary, resetUsage, subscribeGoogleUsage } from '../google/usage.js';

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

  // SKU bazında çağrı sayısı ve tahmini maliyet (bu ay, bu cihaz)
  const rowsEl = $('g-usage-rows');
  const paintUsage = () => {
    const s = usageSummary();
    $('g-usage-head').textContent = `Google kullanımı (${s.month}): ${s.rows.reduce((a, r) => a + r.n, 0)} çağrı · tahmini ${s.total.toFixed(2)} $`;
    if (!s.rows.length) { rowsEl.textContent = 'Bu ay henüz Google çağrısı yok.'; return; }
    rowsEl.replaceChildren(...s.rows.map((r) => {
      const pct = r.n / r.free;
      const el = document.createElement('div');
      el.className = 'g-usage-row' + (pct > 1 ? ' over' : pct >= 0.8 ? ' near' : '');
      const name = Object.assign(document.createElement('span'), { textContent: r.label });
      const num = Object.assign(document.createElement('b'), {
        textContent: `${r.n} / ${r.free} ücretsiz · ${r.cost > 0 ? r.cost.toFixed(2) + ' $' : '0 $'}`,
      });
      const bar = document.createElement('i');
      bar.style.setProperty('--p', `${Math.min(100, pct * 100).toFixed(1)}%`);
      el.append(name, num, bar);
      return el;
    }));
  };
  subscribeGoogleUsage(paintUsage);
  $('g-usage-reset').addEventListener('click', () => { if (confirm('Çağrı sayacı sıfırlansın mı?')) { resetUsage(); toast('Sayaç sıfırlandı'); } });
  paintUsage();

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
