// Canlı trafik sağlayıcı koruması (SAF, çevrimdışı; hiçbir şey içe aktarmaz). v0.99.49'dan beri js/nav/ahead.js refreshTraffic kullanır.
// Yoldaki canlı trafik sonucu (fetchTrafficAhead → trafficSource) yalnızca seçilen plan rotasını veren sağlayıcıyla (routeMeta.provider)
// AYNI ise plana işlenir; aksi hâlde hızlar, enerji, trafik renkleri, kalan süre, uyarı metni ve ses değişmez (fail-closed).
// İzin verilenler (bugünkü davranış):
//   - tomtom → tomtom, yalnızca açık harita tomtom iken (TomTom sonuçları yalnızca TomTom haritasında gösterilir)
//   - mapbox → mapbox, açık harita ne olursa olsun
// Diğer her şey reddedilir: bilinmeyen/boş/osm/here/google sağlayıcı, farklı sağlayıcılar, TomTom haritası dışında TomTom.
// Ağ, anahtar, DOM, depolama yok. Dönen nesne dondurulmuştur; yalnızca sabit gerekçe kodu içerir (ham sağlayıcı verisi yok).

const f = Object.freeze;
const ALLOW = f({ ok: true, reason: 'same-provider' });
const deny = (reason) => f({ ok: false, reason });
const R = f({
  noRoute: deny('no-route-provider'),
  noTraffic: deny('no-traffic-source'),
  mismatch: deny('provider-mismatch'),
  unsupported: deny('unsupported-provider'),
  map: deny('tomtom-needs-tomtom-map'),
});

/** { ok, reason }: canlı trafik sonucu seçilen rotaya uygulanabilir mi? Girdiler yalnızca tam eşleşen küçük harfli dizelerle kabul edilir. */
export function trafficUse({ routeProvider, trafficSource, map } = {}) {
  if (typeof routeProvider !== 'string' || !routeProvider) return R.noRoute;
  if (typeof trafficSource !== 'string' || !trafficSource) return R.noTraffic;
  if (routeProvider !== trafficSource) return R.mismatch;
  if (routeProvider === 'mapbox') return ALLOW;
  if (routeProvider === 'tomtom') return map === 'tomtom' ? ALLOW : R.map;
  return R.unsupported;
}
