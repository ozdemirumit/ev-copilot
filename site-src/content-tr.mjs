// Türkçe sayfalar. Yol: "/" kökte (varsayılan dil), İngilizce /en/ altında.
import { icons, routeArt } from './layout.mjs';

const home = (cfg) => `
    <section class="hero">
      <div class="wrap">
        <div>
          <p class="eyebrow">Elektrikli araç rota planlayıcı</p>
          <h1>Şarj molaları dahil, gerçekçi rota planı</h1>
          <p class="lead">EV Route Finder; hız, eğim, rüzgâr, sıcaklık ve trafiği hesaba katarak menzili tahmin eder, şarj duraklarını rotaya yerleştirir. Tarayıcıda hemen dene, kurulum gerekmez.</p>
          <div class="cta">
            <a class="btn btn-primary" href="${cfg.appUrl}">Uygulamayı aç</a>
            <a class="btn btn-ghost" href="#indir">Android ve iPhone</a>
          </div>
          <p class="hint">Hesap olmadan çalışır. Kamera ve ABRP gibi bazı özellikler davetle açılır.</p>
        </div>
        ${routeArt({ label: 'Örnek rota: A noktasından B noktasına iki şarj duraklı plan', stop1: '⚡ 18 dk', stop2: '⚡ 12 dk', arrive: 'Varış pili %24 (örnek)', sample: 'örnek gösterim' })}
      </div>
    </section>

    <section class="block" id="ozellikler">
      <div class="wrap">
        <h2>Yolculuğu baştan sona planlar</h2>
        <p class="sub">Menzil kaygısını sayılarla yanıtlar: ne kadar gideceğini, nerede ve ne kadar şarj edeceğini önceden gösterir.</p>
        <div class="grid">
          <article class="card"><div class="ico">${icons.route}</div><h3>Gerçekçi menzil</h3><p>Hız, yol eğimi, rüzgâr, sıcaklık, klima ve trafik hesaba katılır. Pil değeri girdikçe aracının gerçek tüketimini ölçerek tahmini düzeltir.</p></article>
          <article class="card"><div class="ico">${icons.bolt}</div><h3>Çok duraklı şarj planı</h3><p>Başlangıç ve varış pilini seç; planlayıcı şarj duraklarını, şarj sürelerini ve varış pilini hesaplar. Şarj eğrisi aracının DC gücüne göre ölçeklenir.</p></article>
          <article class="card"><div class="ico">${icons.gauge}</div><h3>Şarj istasyonları</h3><p>Rota boyunca ve çevrende istasyonlar; güç (kW), işletmeci ve tahmini fiyatla. Kendi istasyonlarını ekleyebilir, operatör fiyatlarını düzenleyebilirsin.</p></article>
          <article class="card"><div class="ico">${icons.nav}</div><h3>Navigasyon ve uyarılar</h3><p>Sesli yönlendirme, 2B/3B harita ve buzlanma gibi yol uyarıları. Premium hesaplarda yol hız limiti de gösterilir.</p></article>
          <article class="card"><div class="ico">${icons.camera}</div><h3>Kamera ve ABRP <span class="tag">Premium</span></h3><p>Telefon kamerası araç göstergesindeki pil yüzdesini okur; okuma cihazında yapılır. Canlı telemetriyi A Better Routeplanner'a aktarabilirsin.</p></article>
          <article class="card"><div class="ico">${icons.globe}</div><h3>11 dil, her cihazda</h3><p>Türkçe dahil 11 dil. Tarayıcıda çalışır, ana ekrana eklenir; Android uygulaması da var. Bağlantı zayıfken yeniden dener.</p></article>
        </div>
      </div>
    </section>

    <section class="block" id="nasil">
      <div class="wrap">
        <h2>Nasıl çalışır?</h2>
        <p class="sub">Üç adımda plan hazır.</p>
        <ol class="steps">
          <li><h3>Aracını seç</h3><p>23 markadan 48 hazır profil var. Değerler tahmindir; batarya, ağırlık ve şarj gücünü kendi aracına göre elle düzeltebilirsin.</p></li>
          <li><h3>Rotanı ve pilini gir</h3><p>Nereden nereye gideceğini ve şimdiki pil yüzdeni yaz. Hava durumu ve rakım profili rotaya otomatik eklenir.</p></li>
          <li><h3>Planı izle</h3><p>Şarj durakları, süre ve varış pili hazır. Navigasyonu başlat; yolda tüketime göre plan güncellenir.</p></li>
        </ol>
        <p class="note" style="margin-top:22px">Menzil, süre ve fiyat bilgileri tahmindir; araç, hava ve yol koşullarına göre değişir. Önemli yolculuklarda şarj durumunu ve istasyon çalışma bilgisini ayrıca kontrol et.</p>
      </div>
    </section>

    <section class="block" id="indir">
      <div class="wrap">
        <h2>İndir</h2>
        <p class="sub">En kolay yol tarayıcı; Android'de uygulama olarak da kurabilirsin.</p>
        <div class="dl">
          <article class="card"><h3>Android</h3><p>Uygulamayı doğrudan APK olarak indir. Google Play sürümü hazırlanıyor.</p><a class="btn btn-primary" href="${cfg.apkUrl}">APK indir</a><span class="btn btn-ghost off" aria-disabled="true">Google Play: yakında</span></article>
          <article class="card"><h3>iPhone</h3><p>Safari'de uygulamayı aç, Paylaş düğmesine dokun ve <b>Ana Ekrana Ekle</b> de. iOS kısıtı nedeniyle ekran kapalıyken konum ve sesli yönlendirme çalışmaz.</p><a class="btn btn-ghost" href="${cfg.appUrl}">Uygulamayı aç</a></article>
          <article class="card"><h3>Tarayıcı</h3><p>Chrome, Edge ve Safari'de çalışır; kurulum ve hesap gerekmez. Telefonda ana ekrana ekleyebilirsin.</p><a class="btn btn-ghost" href="${cfg.appUrl}">Uygulamayı aç</a></article>
        </div>
      </div>
    </section>

    <section class="block" id="sss">
      <div class="wrap faq">
        <h2>Sık sorulanlar</h2>
        <p class="sub">Kısa yanıtlar.</p>
        <details><summary>Hesap gerekli mi?</summary><p>Hayır. Rota planı, istasyon arama ve navigasyon hesap olmadan çalışır. Google ile giriş geçmişini ve ayarlarını cihazlar arasında eşitler; giriş şu an davetle açılıyor. Kamera, ABRP ve Test Modu Premium hesaplara açıktır.</p></details>
        <details><summary>Verilerim nasıl kullanılıyor?</summary><p>Konumun, rota ve istasyon sorguları için sunucumuz üzerinden harita ve veri sağlayıcılarına iletilir. Kamera görüntüsü cihazdan çıkmaz. Ayrıntılar ve hesabını silme adımları için <a href="/gizlilik/">gizlilik politikasına</a> bak.</p></details>
        <details><summary>Hangi araçlar destekleniyor?</summary><p>Togg, Tesla, Hyundai, Kia, BYD, Volkswagen ve daha fazlası dahil 23 markadan 48 hazır profil var. Değerler tahmindir; aracın yoksa ya da farklıysa her değeri elle düzenleyebilirsin.</p></details>
        <details><summary>Togg, ABRP ya da başka markalarla bağlantınız var mı?</summary><p>Hayır. EV Route Finder bağımsız bir projedir; adı geçen markalarla bağlantılı değildir.</p></details>
        <details><summary>Bir sorunla karşılaştım, kime yazmalıyım?</summary><p><a href="mailto:${cfg.email}">${cfg.email}</a> adresine yaz. Cihazını, uygulama sürümünü (Daha Fazla bölümündeki sürüm kartı) ve ne olduğunu eklersen çözmek kolaylaşır.</p></details>
      </div>
    </section>`;

export function pages(cfg) {
  return [
    { key: 'home', lang: 'tr', path: '/', title: 'EV Route Finder · Elektrikli araç rota ve şarj planlayıcı', desc: 'Hız, eğim, rüzgâr ve trafiği hesaba katan elektrikli araç rota planlayıcı: gerçekçi menzil, şarj durakları ve navigasyon. Tarayıcıda ve Android\'de.', body: home(cfg) },
    ...legalTr(cfg),
  ];
}

// Gizlilik ve hesap silme sayfaları (ayrı dosya: content-tr-legal.mjs)
import { legalTr } from './content-tr-legal.mjs';
