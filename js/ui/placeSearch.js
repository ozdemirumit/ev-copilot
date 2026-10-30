// Yer/adres arama (geocoding), anahtarsız ve CORS açık iki OSM servisi birlikte:
//  - Nominatim: yer adlarını her dilde (name:tr "Selanik" → Thessaloniki) eşleştirir, şehir/ülke düzeyinde güçlüdür.
//  - Photon: yazarken tamamlama ve POI/sokak için iyidir ama Türkçe adları çözmez (lang=tr desteklemez).
// Sonuçlar birleştirilir (önce Nominatim). Yalnızca kullanıcı yazarken (350 ms gecikmeli) çağrılır.

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/';
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

async function photon(q, signal) {
  const res = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=7`, { signal });
  if (!res.ok) throw new Error('Photon HTTP ' + res.status);
  const json = await res.json();
  return json.features.map((f) => {
    const p = f.properties;
    const street = p.street ? join(p.street + (p.housenumber ? ' ' + p.housenumber : '')) : '';
    const label = p.name || street || p.city || p.state || '?';
    return {
      label,
      sub: join(p.name && street, p.district, p.city && p.city !== label ? p.city : null, p.state !== label ? p.state : null, p.country),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
    };
  });
}

async function nominatim(q, signal) {
  const res = await fetch(`${NOMINATIM}search?format=jsonv2&limit=6&addressdetails=1&accept-language=tr&q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
  return (await res.json()).map((r) => {
    const a = r.address || {};
    const label = r.name || r.display_name.split(', ')[0];
    const place = a.city || a.town || a.village || a.municipality || a.county;
    return {
      label,
      sub: join(place !== label ? place : null, a.state && a.state !== label && a.state !== place ? a.state : null, a.country),
      lat: Number(r.lat),
      lon: Number(r.lon),
    };
  });
}

/** Aynı yeri iki servis farklı adla döndürebilir: ~2 km içindeki ikinci sonucu at. */
const near = (a, b) => Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.03;

export async function searchPlaces(q, signal) {
  const settled = await Promise.allSettled([nominatim(q, signal), photon(q, signal)]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const merged = [];
  settled.forEach((s) => {
    if (s.status !== 'fulfilled') return;
    s.value.forEach((r) => { if (!merged.some((m) => near(m, r))) merged.push(r); });
  });
  if (!merged.length && settled.every((s) => s.status === 'rejected')) throw settled[0].reason;
  return merged.slice(0, 8);
}

/** Haritadan seçilen noktaya okunur ad (Nominatim reverse). Başarısızsa null. */
export async function reverseLabel(lat, lon) {
  try {
    const res = await fetch(`${NOMINATIM}reverse?format=jsonv2&zoom=16&accept-language=tr&lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    const a = j.address || {};
    return join(j.name || a.road, a.suburb || a.town || a.city || a.village, a.state) || null;
  } catch {
    return null;
  }
}

/** input'a öneri listesi bağlar. onPick({ label, lat, lon }) seçimde çağrılır. */
export function attachSearch(input, list, onPick) {
  let timer = null;
  let ctrl = null;
  let items = [];

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

  function show(results, message) {
    list.replaceChildren();
    items = results;
    if (message) row(message);
    results.forEach((r) => row(r.label, r.sub, () => { hide(); onPick(r); }));
    list.classList.toggle('hidden', !list.children.length);
  }

  async function run() {
    const q = input.value.trim();
    ctrl?.abort();
    if (q.length < 3) return hide();

    const c = parseCoords(q);
    if (c) return show([{ label: `Koordinat: ${c.lat}, ${c.lon}`, sub: '', ...c }]);

    ctrl = new AbortController();
    show([], 'Aranıyor…');
    try {
      const results = await searchPlaces(q, ctrl.signal);
      show(results, results.length ? '' : 'Sonuç bulunamadı');
    } catch (err) {
      if (err.name !== 'AbortError') show([], 'Arama başarısız (internet?)');
    }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length) { const r = items[0]; hide(); onPick(r); } else { clearTimeout(timer); run(); }
    } else if (e.key === 'Escape') hide();
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('focus', () => input.select());
}
