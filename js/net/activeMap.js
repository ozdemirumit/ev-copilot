// Şu an açık olan harita sağlayıcısının adı ('osm' | 'mapbox' | 'google' | 'tomtom' | null: harita henüz açılmadı).
// TomTom rotası yalnızca TomTom haritası açıkken kullanılır (TomTom sonuçlarının başka sağlayıcının haritasında gösterilmesi kullanım şartlarına
// aykırı olabilir; şart metni doğrulanamadığı için en güvenli yol seçildi). Harita, hazır olunca adını buraya yazar.
let name = null;
export const setActiveMap = (n) => { name = n || null; };
export const activeMap = () => name;
