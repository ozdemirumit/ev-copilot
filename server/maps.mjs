// Harita sağlayıcısı seçimi: OpenFreeMap (osm, anahtarsız) her zaman geçerli; Mapbox, Google, TomTom ve HERE yalnızca .env'de anahtarı varsa ve kullanıcı premium ise
// kullanılır. Sunucu varsayılanı db.json → settings.mapDefault, kullanıcı seçimi u.mapProvider (null/yok = varsayılanı izle).
// Anahtar yalnızca premium kullanıcıya ve yalnızca seçili sağlayıcınınki döner; sonradan kalkarsa sessizce osm'ye düşer (çökme yok).
export const PROVIDERS = ['osm', 'mapbox', 'google', 'tomtom', 'here'];

export function createMaps(store, env = {}) {
  // Güvenlik: tarayıcıya yalnızca herkese açık Mapbox belirteci ("pk.") gider; "sk." gizli belirteç yanlışlıkla konsa bile yapılandırılmamış sayılır.
  const keyOf = (p) => {
    if (p === 'mapbox') { const t = String(env.MAPBOX_MAP_TOKEN || ''); return t.startsWith('pk.') ? t : ''; }
    if (p === 'google') return String(env.GOOGLE_MAPS_BROWSER_KEY || '');
    // Güvenlik: tarayıcıya YALNIZCA ayrı, adres kısıtlı TOMTOM_MAP_KEY gider. Sunucu anahtarı TOMTOM_KEY (doluluk/rota/arama) asla tarayıcıya
    // gönderilmez; TOMTOM_MAP_KEY yoksa TomTom haritası yapılandırılmamış sayılır ve Premium sessizce OpenFreeMap'e (osm) düşer.
    // Yalnızca boşluktan oluşan değer (ör. "TOMTOM_MAP_KEY=   ") de yapılandırılmamış sayılır; geçerli anahtar kırpılmadan, aynen döner.
    if (p === 'tomtom') { const k = String(env.TOMTOM_MAP_KEY || ''); return k.trim() ? k : ''; }
    // Güvenlik: HERE için de YALNIZCA ayrı, Trusted Domains ile kısıtlı HERE_MAP_KEY tarayıcıya gider (karo adresinde apiKey olarak). Sunucu anahtarı HERE_API_KEY
    // (istasyon/hız limiti) asla gönderilmez; HERE_MAP_KEY yoksa HERE haritası yapılandırılmamış sayılır. Yalnızca boşluk da yapılandırılmamıştır.
    if (p === 'here') { const k = String(env.HERE_MAP_KEY || ''); return k.trim() ? k : ''; }
    return '';
  };
  const usable = (p) => p === 'osm' || !!keyOf(p);

  const available = () => ({ mapbox: !!keyOf('mapbox'), google: !!keyOf('google'), tomtom: !!keyOf('tomtom'), here: !!keyOf('here') });

  const getDefault = () => {
    const p = store.data.settings?.mapDefault;
    if (PROVIDERS.includes(p)) return p;
    return usable('tomtom') ? 'tomtom' : 'osm'; // yönetici seçmediyse: TomTom anahtarı varsa Premium için varsayılan TomTom, yoksa OpenFreeMap
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
    if (p === 'tomtom') return { provider: 'tomtom', key: keyOf('tomtom') };
    if (p === 'here') return { provider: 'here', key: keyOf('here') };
    return { provider: 'osm' };
  }

  return { available, getDefault, setDefault, setUser, effective, config };
}
