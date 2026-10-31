// Harita bağdaştırıcısı: Google Maps JavaScript API (vektör harita, koyu şema). mapView.js yalnızca bu arayüzü bilir:
//   marker(pos, content, title) → { setPosition, setContent, remove }   line(coords) → { remove }
//   fit(points, pad)   moveTo({ center, zoom, heading, tilt }, animate)   onClick(fn)   onDragStart(fn)   cursor(c)   resize()
// Konumlar { lat, lon }; zoom Google ölçeğindedir (256 px karo).
import { loadGoogle, googleKey } from '../../google/loader.js';
import { record } from '../../google/usage.js';

export async function createGoogleMap(container) {
  if (!googleKey()) throw new Error('Haritayı görmek için yukarıdaki kutuya Google anahtarını gir');
  await loadGoogle();
  const [maps, markerLib, core] = await Promise.all([
    google.maps.importLibrary('maps'), google.maps.importLibrary('marker'), google.maps.importLibrary('core'),
  ]);
  const gmap = new maps.Map(container, {
    center: { lat: 39.0, lng: 35.0 }, zoom: 6, mapId: 'DEMO_MAP_ID', renderingType: 'VECTOR', colorScheme: 'DARK', clickableIcons: false, // vektör: dönme/eğim için şart
    gestureHandling: 'greedy', streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
  });
  record('maps'); // her harita oluşturma bir Dynamic Maps yüklemesi sayılır
  const ll = (p) => ({ lat: p.lat, lng: p.lon });

  return {
    name: 'google',
    marker(pos, content, title = '') {
      const m = new markerLib.AdvancedMarkerElement({ map: gmap, position: ll(pos), content, title });
      return {
        setPosition: (p) => { m.position = ll(p); },
        setContent: (c) => { if (m.content !== c) m.content = c; },
        remove: () => { m.map = null; },
      };
    },
    line(coords) {
      const pl = new maps.Polyline({
        path: coords.map((c) => ({ lat: c[1], lng: c[0] })), strokeColor: '#2ee6a6', strokeOpacity: 0.85, strokeWeight: 5, map: gmap,
      });
      return { remove: () => pl.setMap(null) };
    },
    fit(points, pad) {
      const b = new core.LatLngBounds();
      points.forEach((p) => b.extend(ll(p)));
      gmap.fitBounds(b, pad);
    },
    moveTo({ center, zoom, heading, tilt }) {
      if (zoom != null) gmap.setZoom(zoom);
      if (tilt != null && gmap.setTilt) gmap.setTilt(tilt);
      if (heading != null && gmap.setHeading) gmap.setHeading(heading);
      if (center) gmap.setCenter(ll(center));
    },
    onClick: (fn) => gmap.addListener('click', (e) => fn({ lat: e.latLng.lat(), lon: e.latLng.lng() })),
    onDragStart: (fn) => gmap.addListener('dragstart', fn),
    cursor: (c) => gmap.setOptions({ draggableCursor: c }),
    resize: () => core.event.trigger(gmap, 'resize'),
  };
}
