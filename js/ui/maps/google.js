// Harita bağdaştırıcısı: Google Maps JavaScript API. Yalnızca sunucu Premium hesaba Google seçip tarayıcı anahtarı verdiğinde
// kullanılır (js/net/mapConfig.js). Arayüz OpenFreeMap/Mapbox motoruyla (mapEngine.js) aynıdır: konum { lat, lon }, zoom web-mercator
// ölçeği (Google'ın kendi ölçeği: ofset yok). Yalnızca harita kitaplığı yüklenir (yer arama kitaplığı ve yer kartı hedef dışı).
// Anahtar HTTP yönlendirenine kısıtlı bir TARAYICI anahtarıdır: yalnızca bellekte ve betik adresinde durur, cihaza yazılmaz, günlüğe yazılmaz.
// Google şartları: Google logosu ve kullanım şartları bağlantısı görünür kalır (gizlenmez).

const MAP_TIMEOUT_MS = 25000; // harita 25 sn içinde 'idle' olmazsa açılış başarısız (çağıran OpenFreeMap'e düşer)
const CALLBACK = '__evcpGmReady'; // betiğin yüklenince çağırdığı genel işlev
const COLORS = { moderate: '#ffb547', heavy: '#ff5d6c', severe: '#c4001d' }; // trafik: mapEngine.js ile aynı renkler

let loading = null;
/** Google Maps JS'i bir kez yükler (window.google.maps). Betik yüklenemezse reddeder ve sonraki çağrı yeniden dener.
 *  Süre sınırı yoktur: çağıran (createGoogleMap) kendi süresini koyar; asılı kalan yükleme geç de olsa sonraki çağrıda kullanılır. */
export function loadGoogleMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  loading ??= new Promise((resolve, reject) => {
    const lang = (document.documentElement?.lang || 'tr').slice(0, 2);
    const q = new URLSearchParams({ key, v: 'quarterly', loading: 'async', language: lang, callback: CALLBACK });
    const s = Object.assign(document.createElement('script'), { src: `https://maps.googleapis.com/maps/api/js?${q}`, async: true });
    const fail = () => { loading = null; s.remove(); reject(new Error('Google Haritalar kütüphanesi yüklenemedi')); }; // iletide anahtar yok
    window[CALLBACK] = () => (window.google?.maps?.importLibrary ? resolve(window.google.maps) : fail());
    s.onerror = fail;
    document.head.append(s);
  });
  return loading;
}

/**
 * @param {HTMLElement} container
 * @param {string} key Google tarayıcı anahtarı; yalnızca bellekte
 * @param {string} [mapId] sunucudan (GOOGLE_MAP_ID); yoksa DEMO_MAP_ID (vektör harita: yön/eğim için gerekli)
 * @param {{ onAuthFail?: () => void, libTimeoutMs?: number, loadLib?: (key: string) => Promise<any> }} [o]
 *   onAuthFail: Google anahtarı reddedince (gm_authFailure: etkin olmayan API, adres kısıtı, fatura) bir kez çağrılır; harita açılırken
 *   gelirse söz ayrıca hemen reddedilir. libTimeoutMs: kütüphane yükleme süresi (varsayılan 25 sn; harita yüklemesi ayrıca 25 sn).
 *   loadLib: testler için yükleyici.
 */
export async function createGoogleMap(container, key, mapId = 'DEMO_MAP_ID', { onAuthFail, libTimeoutMs = 25000, loadLib = loadGoogleMaps } = {}) {
  // Kimlik hatası: Google sayfa genelindeki window.gm_authFailure işlevini (bağımsız değişkensiz) çağırır; hangi haritanın olduğunu söylemez.
  // Bu yüzden her createGoogleMap çağrısı onu kendi işleyicisiyle değiştirir (sayfada aynı anda tek Google haritası açılır; son çağrı geçerli).
  // İşleyici tek seferliktir (authFailed): Google birden çok kez çağırsa da onAuthFail ve ret bir kez olur.
  let authFailed = false;
  let rejectAuth;
  const authFail = new Promise((_, reject) => { rejectAuth = reject; });
  authFail.catch(() => {}); // açılış bittikten sonra gelen ret işlenmemiş sayılmasın
  window.gm_authFailure = () => {
    if (authFailed) return;
    authFailed = true;
    onAuthFail?.();
    rejectAuth(new Error('Google haritası yüklenemedi (anahtar reddedildi)'));
  };

  // Betik yanıt vermeden asılı kalırsa onerror dakikalarca gelmeyebilir; 'maps' modülünün indirilmesi (importLibrary) de asılı kalabilir.
  // İkisi tek süre sınırı altında: süre dolunca reddet (çağıran OpenFreeMap'e düşer).
  // Önbellekteki yükleme sözüne dokunulmaz: geç de olsa yüklenirse sonraki çağrı onu kullanır.
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Google Haritalar kütüphanesi zamanında yüklenemedi')), libTimeoutMs); });
  const loadMapsLib = async () => {
    const ns = await loadLib(key);
    const { Map } = await ns.importLibrary('maps');
    return { gm: ns, GMap: Map };
  };
  const { gm, GMap } = await Promise.race([loadMapsLib(), deadline, authFail]).finally(() => clearTimeout(timer));

  // Harita kendi alt öğesine kurulur: açılış başarısızsa bu öğe kaldırılır, Google'ın hata yazısı sonradan açılan OpenFreeMap'in üstüne düşmez.
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'absolute', inset: '0' });
  container.append(host);
  const map = new GMap(host, {
    center: { lat: 39.0, lng: 35.0 }, zoom: 6, mapId, colorScheme: 'DARK', renderingType: 'VECTOR', mapTypeId: 'roadmap',
    disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: false,
  });
  let mapTimer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        mapTimer = setTimeout(() => reject(new Error('Google haritası yüklenemedi (internet?)')), MAP_TIMEOUT_MS);
        gm.event.addListenerOnce(map, 'idle', resolve);
      }),
      authFail,
    ]);
    // 'idle' ile gm_authFailure aynı görevde gelirse yarışı 'idle' kazanabilir: anahtar reddedilmiş haritayı açılmış sayma
    // (yoksa çağıran "gösterildi" demeden onAuthFail almış olur ve bozuk harita ekranda kalır).
    if (authFailed) throw new Error('Google haritası yüklenemedi (anahtar reddedildi)');
  } catch (err) {
    try { gm.event.clearInstanceListeners(map); } catch { /* yarım harita: temizlik hatası yoksayılır */ }
    host.remove();
    throw err;
  } finally {
    clearTimeout(mapTimer);
  }

  // HTML işaretçi: OverlayView; içerik alt-orta noktasından konumlanır (motordaki anchor: 'bottom' ile aynı)
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
  let fitCap = null; // fit() sonrası zoom sınırı dinleyicisi (en çok bir tane)

  return {
    name: 'google',
    // Rota/trafik çizgileri Google'da harita türü değişince kaybolmaz: yeniden kurulacak katman yok (motorla aynı yöntem kümesi için)
    installLayers() {},
    setSatellite(on) { map.setMapTypeId(on ? 'hybrid' : 'roadmap'); }, // Google'ın kendi uydu görüntüsü (Esri karıştırılmaz)
    // 3B: eğim vektör haritada moveTo({ tilt }) ile gelir; 3B binaları Google (bulunduğu yerlerde) kendisi çizer (motorla aynı yöntem kümesi için)
    setBuildings3d() {},
    marker(pos, content, title = '') {
      const m = new HtmlMarker(pos, content, title);
      return {
        setPosition: (p) => { m.pos = p; m.draw(); },
        setContent: (c) => { if (m.div.firstChild !== c) m.div.replaceChildren(c); },
        remove: () => m.setMap(null),
      };
    },
    /** spans: [{ from, to, lvl }] (km). Her aralık, rota koordinatlarından kesilip ayrı çizgi olur; boş dizi hepsini kaldırır. */
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
      routeLine = new gm.Polyline({ map, path: path(coords), strokeColor: '#1a73e8', strokeWeight: 6, strokeOpacity: 0.92, zIndex: 1 });
      // motorla aynı: tek rota çizgisi vardır, remove() onu (hangi tutamaçtan çağrılırsa) kaldırır
      return { remove: () => { routeLine?.setMap(null); routeLine = null; } };
    },
    fit(points, pad) {
      const b = new gm.LatLngBounds();
      points.forEach((p) => b.extend({ lat: p.lat, lng: p.lon }));
      map.fitBounds(b, pad);
      // motordaki maxZoom: 16. Art arda fit() çağrılarında dinleyici birikmesin: öncekini kaldır, tek dinleyici kalsın.
      fitCap?.remove();
      fitCap = gm.event.addListenerOnce(map, 'idle', () => { fitCap = null; if (map.getZoom() > 16) map.setZoom(16); });
    },
    moveTo({ center, zoom, heading, tilt }, animate = false) {
      // Takipte yalnızca merkez değişiyorsa panTo akıcı kaydırır; diğer durumlarda moveCamera (Google'da kamera anında konur)
      if (animate && center && zoom == null && heading == null && tilt == null) return map.panTo({ lat: center.lat, lng: center.lon });
      const o = {};
      if (center) o.center = { lat: center.lat, lng: center.lon };
      if (zoom != null) o.zoom = zoom;
      if (heading != null) o.heading = heading;
      if (tilt != null) o.tilt = tilt;
      map.moveCamera(o);
    },
    onClick: (fn) => map.addListener('click', (e) => { if (e.latLng) fn({ lat: e.latLng.lat(), lon: e.latLng.lng() }); }),
    onDragStart: (fn) => map.addListener('dragstart', fn), // yalnızca kullanıcı sürüklemesi
    cursor: (c) => map.setOptions({ draggableCursor: c || null }),
    resize: () => gm.event.trigger(map, 'resize'), // Google kabın boyutunu kendisi izler; eski sürümler için zararsız
    bearing: () => map.getHeading() || 0,
  };
}
