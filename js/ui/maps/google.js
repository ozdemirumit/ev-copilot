// Harita bağdaştırıcısı: Google Maps JavaScript API (yalnızca Premium "Google modu"). maplibre.js ile aynı arayüz: konum { lat, lon }, zoom web-mercator ölçeği.
// Anahtar sunucudan (/v1/google/map-key) Premium hesaba verilir, HTTP yönlendirenine kısıtlı bir TARAYICI anahtarıdır; telefona yazılmaz, saklanmaz.
// Google verisi (Places UI Kit, doluluk) Google haritası üzerinde gösterilebildiği için yalnızca bu modda haritada görünür.
let loading = null;

function loadMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const t = setTimeout(() => { loading = null; reject(new Error('Google Haritalar yüklenemedi (internet?)')); }, 25000);
    window.__gmReady = () => { clearTimeout(t); resolve(); };
    const lang = (document.documentElement.lang || 'tr').slice(0, 2);
    const s = Object.assign(document.createElement('script'), {
      src: `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places&language=${encodeURIComponent(lang)}&callback=__gmReady`,
      async: true,
    });
    s.onerror = () => { clearTimeout(t); loading = null; reject(new Error('Google Haritalar yüklenemedi (internet?)')); };
    document.head.append(s);
  });
  return loading;
}

/** key/mapId sunucudan. onAuthFail: anahtar reddedilirse (etkin olmayan API, kısıt, fatura) bir kez çağrılır. */
export async function createGoogleMap(container, key, mapId = 'DEMO_MAP_ID', { onAuthFail } = {}) {
  window.gm_authFailure = () => onAuthFail?.();
  await loadMaps(key);
  const { Map: GMap } = await google.maps.importLibrary('maps');
  const gm = google.maps;
  const map = new GMap(container, {
    center: { lat: 39.0, lng: 35.0 }, zoom: 6, mapId, colorScheme: 'DARK', renderingType: 'VECTOR',
    disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: false,
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Google haritası yüklenemedi')), 25000);
    gm.event.addListenerOnce(map, 'idle', () => { clearTimeout(t); resolve(); });
  });

  // HTML işaretçi: OverlayView; içerik alt-orta noktasından konumlanır (MapLibre bağdaştırıcısıyla aynı)
  class HtmlMarker extends gm.OverlayView {
    constructor(pos, content, title) {
      super();
      this.pos = pos;
      this.div = document.createElement('div');
      Object.assign(this.div.style, { position: 'absolute', transform: 'translate(-50%, -100%)' });
      if (title) this.div.title = title;
      this.div.append(content);
      this.setMap(map);
    }
    onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.div); }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(new gm.LatLng(this.pos.lat, this.pos.lon));
      if (p) Object.assign(this.div.style, { left: p.x + 'px', top: p.y + 'px' });
    }
    onRemove() { this.div.remove(); }
  }

  const path = (coords) => coords.map(([lon, lat]) => ({ lat, lng: lon }));
  let routeLine = null;
  let trafficLines = [];
  const COLORS = { moderate: '#ffb547', heavy: '#ff5d6c', severe: '#c4001d' };

  return {
    name: 'google',
    setSatellite(on) { map.setMapTypeId(on ? 'hybrid' : 'roadmap'); },
    marker(pos, content, title = '') {
      const m = new HtmlMarker(pos, content, title);
      return {
        setPosition: (p) => { m.pos = p; m.draw(); },
        setContent: (c) => { if (m.div.firstChild !== c) m.div.replaceChildren(c); },
        remove: () => m.setMap(null),
      };
    },
    /** spans: [{ from, to, lvl }] (km). Her aralık, rota koordinatlarından kesilip ayrı çizgi olur. */
    traffic(coords, spans) {
      trafficLines.forEach((l) => l.setMap(null));
      trafficLines = [];
      if (!spans?.length) return;
      const cum = [0];
      for (let i = 1; i < coords.length; i++) {
        const dLat = ((coords[i][1] - coords[i - 1][1]) * Math.PI) / 180;
        const dLon = ((coords[i][0] - coords[i - 1][0]) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((coords[i - 1][1] * Math.PI) / 180) * Math.cos((coords[i][1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
        cum.push(cum[i - 1] + 6371 * 2 * Math.asin(Math.sqrt(a)));
      }
      const at = (km) => { let i = 0; while (i < cum.length - 1 && cum[i + 1] < km) i++; return i; };
      for (const s of spans) {
        const seg = coords.slice(at(s.from), Math.min(coords.length - 1, at(s.to) + 1) + 1);
        if (seg.length < 2) continue;
        trafficLines.push(new gm.Polyline({ map, path: path(seg), strokeColor: COLORS[s.lvl] || COLORS.moderate, strokeWeight: 6, strokeOpacity: 0.95, zIndex: 2 }));
      }
    },
    line(coords) {
      routeLine?.setMap(null);
      routeLine = new gm.Polyline({ map, path: path(coords), strokeColor: '#2ee6a6', strokeWeight: 5, strokeOpacity: 0.85, zIndex: 1 });
      return { remove: () => { routeLine?.setMap(null); routeLine = null; } };
    },
    fit(points, pad) {
      const b = new gm.LatLngBounds();
      points.forEach((p) => b.extend({ lat: p.lat, lng: p.lon }));
      map.fitBounds(b, pad);
      gm.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); });
    },
    moveTo({ center, zoom, heading, tilt }, animate = false) {
      if (animate && center && zoom == null && heading == null && tilt == null) return map.panTo({ lat: center.lat, lng: center.lon });
      const o = {};
      if (center) o.center = { lat: center.lat, lng: center.lon };
      if (zoom != null) o.zoom = zoom;
      if (heading != null) o.heading = heading;
      if (tilt != null) o.tilt = tilt;
      map.moveCamera(o);
    },
    onClick: (fn) => map.addListener('click', (e) => fn({ lat: e.latLng.lat(), lon: e.latLng.lng() })),
    onDragStart: (fn) => map.addListener('dragstart', fn),
    cursor: (c) => map.setOptions({ draggableCursor: c || null }),
    resize: () => gm.event.trigger(map, 'resize'),
    bearing: () => map.getHeading() || 0,
  };
}
