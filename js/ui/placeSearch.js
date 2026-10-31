// Yer/adres arama kutusu (öneri listesi). Veri, seçili veri kaynağından gelir (providers/index.js); yalnızca kullanıcı yazarken (350 ms gecikmeli) çağrılır.
import { searchPlaces, resolvePlace } from '../providers/index.js';

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** "39.92, 32.85" biçimindeki metni konuma çevirir (yapıştırılan koordinatlar için). */
export function parseCoords(text) {
  const m = COORD.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

const join = (...parts) => parts.filter(Boolean).join(', ');
const newToken = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

/** input'a öneri listesi bağlar. onPick({ label, sub, lat, lon }) seçimde çağrılır. */
export function attachSearch(input, list, onPick) {
  let timer = null;
  let ctrl = 0; // en son aramanın sırası: eski yanıtlar yok sayılır
  let items = [];
  let token = newToken();

  const hide = () => { list.classList.add('hidden'); list.replaceChildren(); items = []; };

  function row(text, sub, onSelect) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const b = document.createElement('b');
    b.textContent = text; // dış kaynaklı metin: textContent (HTML olarak yorumlanmaz)
    li.append(b);
    if (sub) li.append(Object.assign(document.createElement('span'), { textContent: sub }));
    if (onSelect) li.addEventListener('pointerdown', (e) => { e.preventDefault(); onSelect(); });
    else li.classList.add('info');
    list.append(li);
  }

  async function pick(r) {
    hide();
    if (r.lat != null) return onPick(r);
    show([], 'Konum alınıyor…');
    try {
      const full = await resolvePlace(r, token);
      token = newToken(); // oturum Place Details ile kapandı
      hide();
      onPick(full);
    } catch (err) {
      show([], err.message || 'Konum alınamadı');
    }
  }

  function show(results, message) {
    list.replaceChildren();
    items = results;
    if (message) row(message);
    results.forEach((r) => row(r.label, r.sub, () => pick(r)));
    list.classList.toggle('hidden', !list.children.length);
  }

  async function run() {
    const q = input.value.trim();
    const mine = ++ctrl;
    if (q.length < 3) return hide();

    const c = parseCoords(q);
    if (c) return show([{ label: `Koordinat: ${c.lat}, ${c.lon}`, sub: '', ...c }]);

    show([], 'Aranıyor…');
    try {
      const results = await searchPlaces(q, token);
      if (mine !== ctrl) return;
      show(results, results.length ? '' : 'Sonuç bulunamadı');
    } catch (err) {
      if (mine === ctrl) show([], err.message || 'Arama başarısız (internet?)');
    }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length) pick(items[0]); else { clearTimeout(timer); run(); }
    } else if (e.key === 'Escape') hide();
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('focus', () => input.select());
}
