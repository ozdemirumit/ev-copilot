// Harita sağlayıcısı seçimi: OpenFreeMap (osm, anahtarsız) her zaman geçerli; Mapbox ve Google yalnızca .env'de anahtarı varsa ve kullanıcı premium ise
// kullanılır. Sunucu varsayılanı db.json → settings.mapDefault, kullanıcı seçimi u.mapProvider (null/yok = varsayılanı izle).
// Anahtar yalnızca premium kullanıcıya ve yalnızca seçili sağlayıcınınki döner; sonradan kalkarsa sessizce osm'ye düşer (çökme yok).
export const PROVIDERS = ['osm', 'mapbox', 'google'];

export function createMaps(store, env = {}) {
  const keyOf = (p) => (p === 'mapbox' ? env.MAPBOX_MAP_TOKEN : p === 'google' ? env.GOOGLE_MAPS_BROWSER_KEY : '') || '';
  const usable = (p) => p === 'osm' || !!keyOf(p);

  const available = () => ({ mapbox: !!keyOf('mapbox'), google: !!keyOf('google') });

  const getDefault = () => {
    const p = store.data.settings?.mapDefault;
    return PROVIDERS.includes(p) ? p : 'osm';
  };

  // Ad geçerli ve anahtarı tanımlı mı; değilse Error.
  function check(p) {
    if (!PROVIDERS.includes(p)) throw new Error('geçersiz sağlayıcı');
    if (!usable(p)) throw new Error('anahtar yok');
  }

  function setDefault(p) {
    check(p);
    (store.data.settings ||= {}).mapDefault = p;
    store.save();
  }

  /** p === null: kullanıcı seçimini kaldırır (varsayılanı izler). */
  function setUser(u, p) {
    if (p === null) delete u.mapProvider;
    else { check(p); u.mapProvider = p; }
    store.save();
  }

  /** Gerçekte kullanılacak sağlayıcı: premium değilse osm; seçim/varsayılanın anahtarı yoksa osm. u null olabilir (eski erişim kodu). */
  function effective(u, premium) {
    if (!premium) return 'osm';
    const p = u?.mapProvider ?? getDefault();
    return PROVIDERS.includes(p) && usable(p) ? p : 'osm';
  }

  function config(u, premium) {
    const p = effective(u, premium);
    if (p === 'mapbox') return { provider: 'mapbox', token: keyOf('mapbox') };
    if (p === 'google') return { provider: 'google', key: keyOf('google'), mapId: env.GOOGLE_MAP_ID || 'DEMO_MAP_ID' };
    return { provider: 'osm' };
  }

  return { available, getDefault, setDefault, setUser, effective, config };
}
