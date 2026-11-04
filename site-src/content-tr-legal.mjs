// Türkçe gizlilik politikası ve hesap silme sayfası. İçerik kodun gerçekte yaptığına dayanır (veri envanteri: sunucu ve istemci kodu, 2026-11-04);
// uygulama davranışı değişince (yeni veri, yeni sağlayıcı, saklama süresi) bu dosya ve content-en-legal.mjs birlikte güncellenir.
const fmt = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][m - 1]} ${y}`; };

const privacy = (cfg) => `
    <section class="block" style="border:0">
      <div class="wrap doc">
        <h1>Gizlilik politikası</h1>
        <p class="meta">Son güncelleme: ${fmt(cfg.updated)}</p>
        <p>EV Route Finder (“uygulama”), elektrikli araç sürücüleri için bir rota ve şarj planlayıcısıdır. Bu sayfa hangi verileri işlediğimizi, neden işlediğimizi, kimlerle paylaştığımızı ve haklarını anlatır. Uygulamada reklam, analiz ya da izleme aracı yok, çerez kullanılmıyor ve verin satılmıyor.</p>
        <p>Uygulamayı geliştiren ve çalıştıran kişi olarak veri sorumlusuyum. İletişim: <a href="mailto:${cfg.email}">${cfg.email}</a></p>

        <h2>Kısaca</h2>
        <ul>
          <li>Uygulama hesap olmadan da kullanılır. Giriş yaparsan e-posta adresin ve adın saklanır.</li>
          <li>GPS konumun cihazında işlenir ve sürekli sunucuya gönderilmez. Konum yalnızca rota planladığında, istasyon aradığında ya da bildirim gönderdiğinde ilgili sorguyla iletilir.</li>
          <li>Kamera görüntüleri (pil okuma) cihazından çıkmaz.</li>
          <li>Uygulama arka planda konum toplamaz.</li>
          <li>Hesabını ve ona bağlı verileri uygulamadan silebilirsin.</li>
        </ul>

        <h2>İşlediğimiz veriler</h2>
        <table>
          <thead><tr><th>Veri</th><th>Ne zaman ve neden</th></tr></thead>
          <tbody>
            <tr><td><b>Hesap:</b> e-posta, ad, Google hesap numarası (kimlik), oluşturma ve son giriş zamanı, Premium bitiş tarihi</td><td>Google ile giriş yaptığında; hesabını sağlamak için. Profil fotoğrafın saklanmaz.</td></tr>
            <tr><td><b>Oturum:</b> rastgele oturum belirteci</td><td>Giriş açık kalsın diye. Sunucuda yalnızca belirtecin özeti saklanır; 180 gün geçerlidir.</td></tr>
            <tr><td><b>Eşitlenen veriler:</b> ayarlar, araç profili, kayıtlı yerler ve son hedefler, kendi istasyonların, operatör fiyatların, yolculuk ve şarj geçmişi</td><td>Giriş yaptığında; ayarlarını ve geçmişini cihazlar arasında eşitlemek için. Geçmiş kayıtları başlangıç ve varış konumunu yaklaşık 11 metre hassasiyetle, süreyi, enerjiyi ve sıcaklığı içerir.</td></tr>
            <tr><td><b>Cihaz kaydı:</b> cihazında üretilen rastgele kimlik, uygulama sürümü, platform (web ya da Android), ilk ve son görülme zamanı</td><td>Kullanım sayısını görmek ve kötüye kullanımı önlemek için. IP adresin bu kayıtta saklanmaz. Hesaba bağlı olmayan kayıtlar 90 gün sonra silinir.</td></tr>
            <tr><td><b>Topluluk katkıları:</b> fiyat bildirimi (istasyon konumu ve kWh fiyatı), “burada şarj ediyorum” bildirimi, puan, olanak oyu (tuvalet, kafe vb.), istasyon fotoğrafı</td><td>Bunları sen gönderirsen. Diğer giriş yapmış kullanıcılar toplu puanı, oyları ve fotoğrafı görür; kimin gönderdiği görünmez. “Şarj ediyorum” bildirimi ayarlardan kapatılabilir, yaklaşık 100 metrelik bir bölgeye indirgenir ve 3 saat sonra silinir; ev ve iş konumları gönderilmez. Fotoğraflardan konum (EXIF) bilgisi temizlenir; fotoğrafta kişi ya da plaka görünmemesine dikkat et.</td></tr>
            <tr><td><b>Sunucu kayıtları:</b> IP adresi, zaman, istek yolu ve yanıt kodu</td><td>Güvenlik ve hata ayıklama için. Konum gibi sorgu parametreleri kayda yazılmaz.</td></tr>
          </tbody>
        </table>

        <h2>Konum ve kamera</h2>
        <p><b>Konum.</b> Konum izni vermezsen uygulama konumunu bilemez; planı elle girdiğin noktalarla yapabilirsin. İzin verdiğinde GPS konumun cihazında kalır. Sunucuya ya da aşağıdaki hizmetlere yalnızca ilgili sorgunun gerektirdiği koordinatlar gider (örneğin rota başlangıcı ve varışı, çevrendeki istasyonlar).</p>
        <p><b>Kamera.</b> Premium kullanıcılar için pil yüzdesini okuyan özellik, görüntüyü cihazında işler (okuma motoru uygulamayla birlikte gelir). Görüntüler hiçbir yere yüklenmez. Kamerayla çektiğin tek şey, kendin seçip yüklediğin istasyon fotoğrafıdır.</p>

        <h2>Verilerin gittiği hizmetler</h2>
        <p>Rota ve istasyon verisi için üçüncü taraf hizmetler kullanıyoruz. Aşağıdaki tablo kime ne gittiğini gösterir; bu hizmetlerin kendi gizlilik politikaları da geçerlidir (örneğin <a href="https://policies.google.com/privacy" rel="noopener">Google</a>).</p>
        <table>
          <thead><tr><th>Hizmet</th><th>Ne için</th><th>Ne gider</th></tr></thead>
          <tbody>
            <tr><td colspan="3"><b>Sunucumuz üzerinden</b> (hizmet senin IP adresini değil, sunucumuzun adresini görür)</td></tr>
            <tr><td>Mapbox</td><td>Rota ve istasyon arama</td><td>Rota noktaları, arama merkezi koordinatları</td></tr>
            <tr><td>HERE</td><td>İstasyon arama; Premium: yol hız limiti</td><td>Arama merkezi ve yarıçapı; rotadan örneklenen noktalar</td></tr>
            <tr><td>OpenChargeMap, Overpass (OpenStreetMap), NDW</td><td>İstasyon verisi, canlı doluluk</td><td>Bölge koordinatları</td></tr>
            <tr><td>Google Places</td><td>Premium: canlı doluluk (yalnızca düşük pilde)</td><td>İstasyon koordinatları</td></tr>
            <tr><td>Google ile giriş</td><td>Giriş</td><td>E-posta ve ad (Google ile paylaştığın)</td></tr>
            <tr><td>E-posta hizmeti (SMTP)</td><td>Davet e-postası</td><td>Alıcı adresi ve davet metni</td></tr>
            <tr><td colspan="3"><b>Doğrudan cihazından</b> (hizmet IP adresini görür)</td></tr>
            <tr><td>Valhalla (OpenStreetMap / FOSSGIS)</td><td>Rota ve yükseklik</td><td>Başlangıç, ara ve varış koordinatları</td></tr>
            <tr><td>Open-Meteo</td><td>Hava durumu ve rakım</td><td>Rota noktaları ve saatler</td></tr>
            <tr><td>Photon (Komoot), Nominatim (OpenStreetMap)</td><td>Yer arama</td><td>Yazdığın metin ve yaklaşık konum; adres bulma için koordinat</td></tr>
            <tr><td>OpenFreeMap, Esri (uydu görüntüsü)</td><td>Harita karoları</td><td>IP adresin ve baktığın bölge</td></tr>
            <tr><td>Mapbox ya da Google Maps (yalnızca sana atandıysa)</td><td>Harita</td><td>IP adresin ve baktığın bölge</td></tr>
            <tr><td>ABRP (A Better Routeplanner)</td><td>Premium: canlı telemetri, yalnızca sen açarsan</td><td>Pil, hız, konum, yükseklik, dış sıcaklık</td></tr>
            <tr><td>GitHub Pages</td><td>Web uygulamasının dosyalarını sunar (Android uygulaması da bu dosyaları yükler)</td><td>IP adresin</td></tr>
          </tbody>
        </table>
        <p>Kendi API anahtarını ya da kendi webhook adresini girersen ilgili sorgular doğrudan o hizmete gider.</p>

        <h2>Saklama süreleri</h2>
        <ul>
          <li>Hesap, eşitlenen veriler, geçmiş, puanlar ve fotoğraflar: sen silene ya da hesabını silene kadar.</li>
          <li>Oturum: 180 gün. Hesaba bağlı olmayan cihaz kaydı: 90 gün. Fiyat bildirimi: en çok 90 gün. “Şarj ediyorum” bildirimi: 3 saat.</li>
          <li>Yedekler: veri dosyasının günlük yedeğinin son 14 kopyası tutulur. Sildiğin hesap bu yedeklerde en çok yaklaşık 14 gün kalabilir.</li>
          <li>Sunucu kayıtları (IP, zaman, yol): boyuta göre dönen dosyalarda tutulur; ayrı bir süre tanımlı değildir.</li>
        </ul>

        <h2>Hesabını silmek ve haklarını kullanmak</h2>
        <p>Hesabını uygulamadan silebilirsin: <b>Daha fazla &gt; Hesap &gt; Hesabı sil</b>. Ayrıntılar ve uygulamaya erişemeyenler için e-posta yolu <a href="/hesap-silme/">hesap silme sayfasında</a>.</p>
        <p>Kişisel verilerine erişme, düzeltme, silme, işlemeye itiraz etme ve verini taşıma hakkın var (KVKK madde 11 ve GDPR kapsamında). <a href="mailto:${cfg.email}">${cfg.email}</a> adresine yazman yeterli. Yanıtsız kalırsa, bulunduğun ülkedeki veri koruma otoritesine (Türkiye'de Kişisel Verileri Koruma Kurulu) başvurabilirsin.</p>
        <p>Verileri; hesabı sağlamak (sözleşmenin ifası), güvenlik (meşru menfaat) ve konum, kamera ve fotoğraf yükleme gibi işlemlerde senin onayın (izin verirsin, istediğin an geri alırsın) dayanaklarıyla işliyoruz.</p>

        <h2>Güvenlik</h2>
        <p>Veriler HTTPS ile iletilir. Oturum belirteçleri sunucuda yalnızca özet olarak saklanır. Sunucu, geliştiricinin işlettiği bir bilgisayardır ve erişimi kısıtlıdır; yine de hiçbir sistemin tamamen güvenli olduğu söylenemez. Bir güvenlik sorunu fark edersen lütfen <a href="mailto:${cfg.email}">${cfg.email}</a> adresine bildir.</p>

        <h2>Çocuklar</h2>
        <p>Uygulama 13 yaşın altındaki çocuklara yönelik değildir ve onlardan bilerek veri toplamayız.</p>

        <h2>Değişiklikler</h2>
        <p>Uygulama yeni bir veri işlemeye başlarsa bu sayfayı güncelleriz; en üstteki tarih değişir.</p>
      </div>
    </section>`;

const del = (cfg) => `
    <section class="block" style="border:0">
      <div class="wrap doc">
        <h1>Hesap silme</h1>
        <p class="meta">Son güncelleme: ${fmt(cfg.updated)}</p>
        <p>EV Route Finder hesabını ve ona bağlı verileri istediğin an silebilirsin.</p>

        <h2>Uygulamadan sil</h2>
        <ol>
          <li>Uygulamada <b>Daha fazla</b> sekmesini aç.</li>
          <li><b>Hesap</b> kartında <b>Hesabı sil</b> düğmesine dokun ve onayla.</li>
        </ol>

        <h2>Uygulamaya erişemiyorsan</h2>
        <p>Hesabına bağlı Google adresinden <a href="mailto:${cfg.email}?subject=Hesap%20silme">${cfg.email}</a> adresine “Hesap silme” konulu bir e-posta gönder. Talebini doğrulayıp hesabını en geç 30 gün içinde silerim.</p>

        <h2>Neler silinir?</h2>
        <ul>
          <li>Hesap kaydın (e-posta, ad, Google hesap numarası) ve tüm oturumların.</li>
          <li>Eşitlenen ayarların, kayıtlı yerlerin, kendi istasyonların ve yolculuk ile şarj geçmişin.</li>
          <li>Fiyat bildirimlerin, “şarj ediyorum” bildirimlerin, puanların, olanak oyların ve yüklediğin istasyon fotoğrafları.</li>
          <li>Hesabına bağlı cihaz kaydı (başka bir hesaba bağlı değilse).</li>
        </ul>

        <h2>Neler kalır?</h2>
        <ul>
          <li><b>Yedekler:</b> veri dosyasının günlük yedeklerinin son 14 kopyası; silinen hesap bunlarda en çok yaklaşık 14 gün kalır, sonra kendiliğinden silinir.</li>
          <li><b>Sunucu kayıtları</b> (IP, zaman, istek yolu): hesabınla ilişkilendirilmez; boyuta göre dönen dosyalarda tutulur.</li>
          <li><b>Anonim sayaçlar:</b> sağlayıcılara giden istek sayıları kimliksiz toplam olarak kalır.</li>
          <li><b>Cihazındaki yerel veriler:</b> uygulamayı kaldırınca ya da tarayıcı verisini temizleyince silinir.</li>
        </ul>
        <p>Daha fazla bilgi için <a href="/gizlilik/">gizlilik politikasına</a> bak.</p>
      </div>
    </section>`;

export function legalTr(cfg) {
  return [
    { key: 'privacy', lang: 'tr', path: '/gizlilik/', title: 'Gizlilik politikası · EV Route Finder', desc: 'EV Route Finder hangi verileri işler, kimlerle paylaşır, ne kadar saklar ve hesabını nasıl silersin.', body: privacy(cfg) },
    { key: 'delete', lang: 'tr', path: '/hesap-silme/', title: 'Hesap silme · EV Route Finder', desc: 'EV Route Finder hesabını ve verilerini nasıl silersin.', body: del(cfg) },
  ];
}
