// İstasyonlar > Filtre > Ara (v0.99.105): arama sürerken dokunuş yutulmaz, tam bir kez seçili süzgeçle yeniden arar;
// konum yoksa dokunuşta tek seferlik konum istenir; kaynak hatası/kotası "istasyon yok" diye gösterilmez.
// Kullanım: node scripts/test-near-search.mjs  (çevrimdışı; ağ ve DOM yok)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const { createSearchGate, classifySearchErrors, emptyListText, locationErrorText } = await import('../js/nav/nearSearch.js');

// ---- Kapı: boşta başlar, sürüyorken elle istek bekler, sessiz istek düşer ----
{
  const g = createSearchGate();
  ok('boşta: başlar', g.begin({ silent: true }).start === true && g.busy);
  ok('sürüyor + sessiz: düşer (döngü yok)', g.begin({ silent: true }).kind === 'dropped' && g.pending === null);
  ok('sürüyor + elle: bekler', g.begin({ force: true }).kind === 'queued');
  ok('art arda elle dokunuşlar tek bekleyende birleşir', g.begin({}).kind === 'queued' && g.pending.force === true);
  const next = g.end();
  ok('bitince bekleyen bir kez döner', next && next.force === true && next.silent === false);
  ok('bekleyen temizlendi, kapı boş', g.pending === null && !g.busy);
  ok('ikinci end() boş döner (çift arama yok)', g.end() === null);
}

// ---- Uçtan uca benzetim: sekme açılınca sessiz arama, sürerken yarıçap 25 seçilip Ara'ya basılır ----
{
  const g = createSearchGate();
  const filters = { radius: 'auto' };
  const calls = [];
  let release;
  const search = async (opts) => {
    const r = g.begin(opts);
    if (!r.start) return r.kind;
    let next = null;
    try {
      calls.push({ radius: filters.radius, force: !!opts.force });
      if (calls.length === 1) await new Promise((res) => { release = res; }); // ilk (sessiz) arama yavaş
    } finally { next = g.end(); }
    if (next) return search(next);
    return 'done';
  };
  const first = search({ silent: true });
  filters.radius = 25;
  ok('sürerken Ara: sıraya alındı (yutulmadı)', await search({ force: true }) === 'queued');
  ok('sürerken ikinci dokunuş da çift arama yapmaz', await search({ force: true }) === 'queued');
  ok('sürerken otomatik tazeleme düşer', await search({ silent: true }) === 'dropped');
  release();
  await first;
  ok('toplam tam iki arama (sessiz + bir elle)', calls.length === 2, JSON.stringify(calls));
  ok('elle arama seçili yarıçapla ve force', calls[1]?.radius === 25 && calls[1]?.force === true, JSON.stringify(calls));
}

// ---- Hata sınıfı: kota/sınır ≠ kesinti ≠ UI hatası ----
ok('hata yok → null', classifySearchErrors([]) === null);
ok('429 → quota', classifySearchErrors(['Overpass 429']) === 'quota');
ok('402 → quota', classifySearchErrors(['Mapbox: 402 Payment Required']) === 'quota');
ok('kota metni → quota', classifySearchErrors(['Günlük kota doldu']) === 'quota');
ok('zaman aşımı → outage', classifySearchErrors(['Overpass zaman aşımı (Fetch is aborted)']) === 'outage');
ok('Arama başarısız: … → outage', classifySearchErrors(['Arama başarısız: Failed to fetch']) === 'outage');

// ---- Boş liste metni: hata varken "istasyon yok" denmez ----
ok('aranmadı ve hata yok → boş', emptyListText({ searched: false }) === '');
ok('arandı, sonuç yok, AC kapalı → DC ipucu', /hızlı \(DC\) istasyon bulunamadı/.test(emptyListText({ searched: true })));
ok('arandı, sonuç yok, AC açık', emptyListText({ searched: true, showAc: true }) === 'Bu çevrede istasyon bulunamadı.');
{
  const t = emptyListText({ searched: true, errors: ['timeout'] });
  ok('kesinti: "bulunamadı" demez', !/bulunamadı/.test(t) && /ulaşılamadı/.test(t), t);
  const q = emptyListText({ searched: false, errors: ['HTTP 429'] });
  ok('kota: uygulama hatası olmadığı söylenir (arama hiç tamamlanmasa da)', /kota/.test(q) && /uygulama hatası değil/.test(q), q);
}

// ---- Konum hatası metinleri ----
ok('izin reddi (1) ayarlara yönlendirir', /izni kapalı/.test(locationErrorText(1)));
ok('zaman aşımı (3)', /zamanında alınamadı/.test(locationErrorText(3)));
ok('diğer', /Konum alınamadı/.test(locationErrorText(2)));
ok('yok olan "üstteki 📍" düğmesine yönlendirmez', ![1, 2, 3, 0].some((c) => /üstteki/.test(locationErrorText(c))));

// ---- nearby.js bağlantı sözleşmesi ----
{
  const src = read('js/nav/nearby.js');
  const fn = src.slice(src.indexOf('export async function refreshNearby'), src.indexOf('async function refreshOccupancy'));
  ok('refreshNearby busy iken sessizce dönmez (kapı kullanır)', !/if \(busy\) return;/.test(fn) && /gate\.begin\(\{ force, silent \}\)/.test(fn));
  ok('kapı finally içinde kapanır (takılı kalmaz)', /finally \{[^}]*next = gate\.end\(\);/.test(fn));
  ok('bekleyen elle istek bir kez çalışır', /if \(next\) return refreshNearby\(next\);/.test(fn));
  ok('Ara tıklaması searchFromButton çağırır', /\$\('near-refresh'\)\.addEventListener\('click', \(\) => \{ searchFromButton\(\); \}\)/.test(src));
  ok('searchFromButton konum yoksa locateOnce ister', /export async function searchFromButton[\s\S]{0,200}locateOnce\(\)/.test(src));
  ok('boş liste emptyListText ile (hata ≠ istasyon yok)', /emptyListText\(\{ searched: !!meta\.at, errors: meta\.errors, showAc \}\)/.test(src));
  ok('yarıçap değişimi yine tek refreshNearby({force:true})', /save\('nearRadiusMode', radiusSetting\);\n\s*refreshNearby\(\{ force: true \}\);/.test(src));
  ok('Ara düğmesi yükleniyor durumu (aria-busy)', /setAttribute\('aria-busy'/.test(src));
}
{
  const html = read('index.html');
  ok('Ara düğmesi type=button (form gönderimi/sayfa yenilemesi yok)', /<button class="btn primary" id="near-refresh" type="button">/.test(html));
}

// ---- v0.99.106: Ara'ya her dokunuş düğmenin YANINDA görünür yanıt alır ----
// Kök neden (WebKit/Chromium dokunuş denetimi): dokunuş düğmeye ulaşıyor ve işleyici çalışıyordu, ama durum/sonuç yalnızca yukarıdaki
// "Yakınımdaki istasyonlar" kartına yazılıyordu (liste uzunsa ekran dışında, kart kapalıysa 0×0), .busy sınıfının CSS'i yoktu,
// dokunuş vurgusu kapalı ve :active stili yoktu → aynı sonuçta ekranda HİÇBİR şey değişmiyor, düğme "tıklanmıyor" sanılıyordu.
{
  const { filterStatusText } = await import('../js/nav/nearSearch.js');
  ok('filterStatusText var', typeof filterStatusText === 'function');
  if (typeof filterStatusText === 'function') {
    const at = new Date(2026, 10, 17, 9, 5, 7).getTime();
    ok('özet + saat (aynı sonuçta bile her dokunuş değişir)', filterStatusText('0 istasyon · 1 km çevre · şimdi güncellendi', { at }) === '0 istasyon · 1 km çevre · şimdi güncellendi (09:05:07)');
    ok('boş/hata metni özete eklenir', filterStatusText('0 istasyon', { extra: 'İstasyon kaynağına şu an ulaşılamadı', at }) === '0 istasyon — İstasyon kaynağına şu an ulaşılamadı (09:05:07)');
    ok('saat yoksa yalnız metin (aranıyor / konum hatası)', filterStatusText('Yakındaki istasyonlar aranıyor…') === 'Yakındaki istasyonlar aranıyor…');
  }
  const html = read('index.html');
  const card = html.slice(html.indexOf('id="filter-card"'), html.indexOf('id="brand-card"'));
  ok('filtre kartında Ara\'nın yanında canlı durum satırı', /id="near-refresh"[\s\S]{0,120}<\/div>\s*<p class="small muted" id="near-filter-status" role="status" aria-live="polite"/.test(card));
  const src = read('js/nav/nearby.js');
  const ps = src.slice(src.indexOf('function paintStatus'), src.indexOf('function paintStatus') + 400);
  ok('paintStatus filtre satırına da yazar', /\$\('near-filter-status'\)/.test(ps) && /filterStatusText\(/.test(ps));
  ok('elle arama bitince saat damgası (manualAt) güncellenir', /if \(!silent\) manualAt = Date\.now\(\);/.test(src));
  const css = read('css/styles.css');
  ok('Ara basılma geri bildirimi (:active)', /#near-refresh:active\s*\{[^}]*transform/.test(css));
  ok('yükleniyor durumu görünür (.btn.busy)', /\.btn\.busy\s*\{[^}]*opacity/.test(css));
  ok('iOS çift dokunuş yakınlaştırma gecikmesi yok (touch-action: manipulation)', /#near-refresh[^{]*\{[^}]*touch-action:\s*manipulation/.test(css));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
