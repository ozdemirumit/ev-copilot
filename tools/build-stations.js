// Yerleşik istasyon listesini (data/stations.json) yenilemek için: herhangi bir sayfanın tarayıcı konsoluna yapıştırın
// (CORS'lu Overpass aynalarını kullanır). ~54 sorgu, 10–15 dk sürer; bitince stations.json dosyası indirilir.
// İndirileni data/stations.json üzerine koyun, version.js'te sürümü artırıp "data/stations.json yenilendi" notunu ekleyin.
// Veri: OpenStreetMap katkıcıları (ODbL). Satır: [lat, lon, ad, operatör metni, kW (0 = yok), DC soket (1/0), herhangi soket etiketi (1/0)]
(async () => {
  const MIRRORS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const DC = ['socket:type2_combo', 'socket:ccs', 'socket:chademo'];
  const KW = ['socket:type2_combo:output', 'socket:ccs:output', 'socket:chademo:output', 'charging_station:output'];
  const NON_PUBLIC = new Set(['private', 'no', 'customers', 'permit', 'delivery', 'agricultural', 'forestry', 'staff', 'residents']);
  const BBOX = [34, 19, 46, 46]; // güney, batı, kuzey, doğu (Türkiye + Yunanistan + Balkanlar)
  const parseKw = (v) => { const n = String(v).match(/[\d.]+/g)?.map(Number) || []; if (!n.length) return null; let m = Math.max(...n); if (m > 1000) m /= 1000; return m; };

  const tiles = [];
  for (let la = BBOX[0]; la < BBOX[2]; la += 2) for (let lo = BBOX[1]; lo < BBOX[3]; lo += 3) tiles.push([la, lo, la + 2, lo + 3]);
  const rows = [];
  const seen = new Set();
  let done = 0;
  for (const [s, w, n, e] of tiles) {
    const q = `[out:json][timeout:60];nwr["amenity"="charging_station"](${s},${w},${n},${e});out center tags;`;
    let els = null;
    for (let attempt = 0; attempt < 6 && !els; attempt++) {
      try {
        const r = await fetch(MIRRORS[attempt % MIRRORS.length], { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(70000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (j.remark && /error|timed out|memory/i.test(j.remark)) throw new Error('remark');
        els = j.elements;
      } catch { await new Promise((r) => setTimeout(r, 2500)); }
    }
    if (!els) throw new Error(`Parça alınamadı: ${s},${w}`);
    for (const el of els) {
      const t = el.tags || {};
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || NON_PUBLIC.has(String(t.access || '').toLowerCase())) continue;
      if (/tesla/i.test([t.name, t.operator, t.brand, t.network].join(' '))) continue;
      const kws = KW.map((k) => (t[k] ? parseKw(t[k]) : null)).filter(Boolean);
      const dc = DC.some((k) => t[k] && t[k] !== 'no') ? 1 : 0;
      const any = Object.keys(t).some((k) => k.startsWith('socket:')) ? 1 : 0;
      const row = [+lat.toFixed(4), +lon.toFixed(4), t.name || '', [t.operator, t.brand, t.network].filter(Boolean).join(' '), kws.length ? Math.max(...kws) : 0, dc, any];
      const key = row[0] + ',' + row[1] + ',' + row[2];
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }
    console.log(`${++done}/${tiles.length} · ${rows.length} istasyon`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const body = JSON.stringify({ date: new Date().toISOString().slice(0, 10), source: 'OpenStreetMap (ODbL) via Overpass', bbox: BBOX, rows });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([body], { type: 'application/json' })), download: 'stations.json' });
  a.click();
})();
