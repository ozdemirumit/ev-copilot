// İstasyonlar > Filtre > Ara: arama kapısı ve boş/hata durumu metinleri (saf; DOM ve ağ yok, Node testinde sınanır).
//
// Sorun (v0.99.105 öncesi): sekme açılınca başlayan sessiz otomatik arama sürerken (proxy Overpass 60 sn × 3 deneme sürebilir)
// Ara'ya dokunmak ya da yarıçapı değiştirmek `if (busy) return` ile sessizce yutuluyordu. Kapı: arama sürerken gelen ELLE istek
// tek bir bekleyen istek olarak saklanır (art arda dokunuşlar birleşir), süren arama bitince seçili süzgeçle TAM BİR kez çalışır.
// Sessiz (otomatik) istekler sıraya alınmaz: ücretli/sınırlı kaynakta döngü olmasın.

export function createSearchGate() {
  let busy = false;
  let pending = null;
  return {
    get busy() { return busy; },
    get pending() { return pending; },
    /** start: true → arama başlayabilir. Sürüyorsa: elle istek bekleyen olarak saklanır ('queued'), sessiz istek yok sayılır ('dropped'). */
    begin(opts = {}) {
      if (!busy) { busy = true; return { start: true, kind: 'start' }; }
      if (opts.silent) return { start: false, kind: 'dropped' };
      pending = { force: !!(opts.force || pending?.force), silent: false };
      return { start: false, kind: 'queued' };
    },
    /** Arama bitti: bekleyen elle istek varsa (bir kez) döner ve temizlenir. */
    end() {
      busy = false;
      const p = pending;
      pending = null;
      return p;
    },
  };
}

const QUOTA_RE = /\b(402|429)\b|kota|quota|limit|too many/i;

/** Hata dizisinin türü: 'quota' (sağlayıcı kotası/sınırı), 'outage' (kaynak/sunucu ulaşılamadı), yoksa null. */
export function classifySearchErrors(errors = []) {
  if (!errors.length) return null;
  return errors.some((e) => QUOTA_RE.test(String(e))) ? 'quota' : 'outage';
}

/**
 * Liste boşken gösterilecek metin. Hata varsa "istasyon yok" DENMEZ (kaynak cevap vermediyse istasyon olmadığı bilinmez).
 * searched: en az bir arama tamamlandı mı.
 */
export function emptyListText({ searched = false, errors = [], showAc = false } = {}) {
  const kind = classifySearchErrors(errors);
  if (kind === 'quota') return 'İstasyon kaynağının istek sınırı/kotası dolu; bu bir uygulama hatası değil. Birkaç dakika sonra "Ara"ya yeniden dokun.';
  if (kind === 'outage') return 'İstasyon kaynağına şu an ulaşılamadı; bu, çevrede istasyon olmadığı anlamına gelmez. Biraz sonra "Ara"ya yeniden dokun.';
  if (!searched) return '';
  return showAc ? 'Bu çevrede istasyon bulunamadı.' : 'Bu çevrede hızlı (DC) istasyon bulunamadı; yavaş AC olanlar için "AC de göster"i aç.';
}

/**
 * İstasyonlar > Filtre kartında Ara düğmesinin hemen altındaki durum satırı. Asıl durum/sonuç yukarıdaki "Yakınımdaki istasyonlar"
 * kartına yazılır; o kart ekran dışında ya da kapalıyken dokunuş hiçbir görünür yanıt almıyordu. at: son elle aramanın bitiş anı —
 * sonuç aynı olsa bile her dokunuşta saat değişir. extra: boş liste / kaynak hatası metni.
 */
export function filterStatusText(status, { extra = '', at = 0 } = {}) {
  const t = at ? new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  return [status, extra].filter(Boolean).join(' — ') + (t ? ` (${t})` : '');
}

/** Ara'ya dokunuşta istenen tek seferlik konum alınamazsa gösterilecek metin. code: GeolocationPositionError.code */
export function locationErrorText(code) {
  if (code === 1) return 'Konum izni kapalı: tarayıcı/telefon ayarlarından bu siteye konum izni ver, sonra "Ara"ya dokun.';
  if (code === 3) return 'Konum zamanında alınamadı (GPS zayıf). Açık alanda "Ara"ya yeniden dokun.';
  return 'Konum alınamadı. Haritadaki konum düğmesine ya da "Ara"ya yeniden dokun.';
}
