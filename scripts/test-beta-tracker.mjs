// Beta Proje Takibi panosu: gerçek kayıttan üretim, durum sayıları, yükseltme yok, kaçış, maskeleme,
// maket bağlantı güvenliği, anlık görüntü/eskime uyarısı, yayına girmeme. Ağ yok.
// Kullanım: node scripts/test-beta-tracker.mjs
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const T = await import('./beta-tracker.mjs');
const reg = JSON.parse(read('docs/beta-task-registry.json'));
const NOW = '2026-11-13T07:00:00Z';
const html = T.renderTracker(reg, { generatedAt: NOW });

// ---- Gerçek kayıt ----
{
  for (const id of ['kararlar', 'maketler', 'planlanan', 'gorevler', 'engeller', 'oncelikler', 'sozluk']) ok(`bölüm #${id}`, html.includes(`id="${id}"`));
  ok('anlık görüntü etiketi', html.includes('Anlık görüntü, canlı değil'));
  ok('kayıt zamanı gösterilir', html.includes(reg.updated));
  ok('üretim zamanı gösterilir', html.includes(NOW));
  ok('yenileme komutu', html.includes('node scripts/beta-tracker.mjs'));
  ok('noindex', html.includes('noindex, nofollow'));
  ok('betik yok', !/<script/i.test(html));
  ok('dış kaynak yok (http src/href)', !/(src|href)="https?:/i.test(html));
  ok('CSP default-src none', html.includes("default-src 'none'"));

  const all = [...reg.tasks, ...reg.orchestrator_only_tasks];
  const c = T.countStates(reg);
  for (const s of T.TASK_STATES) ok(`sayı ${s}`, c[s] === all.filter((t) => t.state === s).length, `${c[s]}`);
  ok('toplam görev sayısı korunur', Object.values(c).reduce((a, b) => a + b, 0) === all.length);
  ok('doğrulanmış sayısı kayıttakiyle aynı (yükseltme yok)', c.verified === all.filter((t) => t.state === 'verified').length);
  if (c.verified === 0) ok('doğrulanmış yok mesajı', html.includes('Kayıtta doğrulanmış görev yok.'));

  for (const t of reg.tasks) if (!html.includes(t.local_session)) { ok(`görev UUID ${t.local_session}`, false); }
  ok('tüm yerel oturum UUID\'leri var', reg.tasks.every((t) => html.includes(t.local_session)));
  ok('tüm orkestratör kimlikleri var', reg.orchestrator_only_tasks.every((t) => html.includes(t.orchestrator_id)));
  ok('commit\'ler var', reg.tasks.filter((t) => /^[0-9a-f]{7}$/.test(t.commit ?? '')).every((t) => html.includes(t.commit)));
  ok('başarısız görevin yerini alanlar bağlı', html.includes('yerini alan:'));

  const planned = reg.roadmap.filter((r) => String(r.status).startsWith('planned'));
  const sec = html.split('id="planlanan"')[1].split('<section')[0];
  ok('planlanan maddeler', planned.length > 0 && planned.every((r) => sec.includes(`<code>${r.id}</code>`)));
  ok('planlanmayan madde planlananda yok', reg.roadmap.filter((r) => !String(r.status).startsWith('planned')).every((r) => !sec.includes(`<code>${r.id}</code>`)));

  const np = T.nextPriorities(reg);
  ok('öncelik sırası P0 önce', np.every((r, i) => i === 0 || (r.priority >= np[i - 1].priority)));
  ok('tamamlanmış madde öncelikte yok', np.every((r) => r.status !== 'completed'));

  if (!reg.decisions) ok('karar yoksa uydurulmaz', html.includes('Kayıtta karar listesi (decisions) yok'));
  if (!reg.mockups) ok('maket yoksa uydurulmaz', html.includes('Kayıtta maket listesi (mockups) yok'));
}

// ---- Eskime ----
{
  // Tarihler kaydın kendi `updated` değerinden türetilir (eşik STALE_HOURS = 24): kayıt her güncellendiğinde sabit tarih eskimesin.
  const at = (hours) => new Date(Date.parse(reg.updated) + hours * 3600e3).toISOString();
  ok('taze kayıtta eskime uyarısı yok', !T.renderTracker(reg, { generatedAt: at(1) }).includes('class="snap stale"'));
  const old = T.renderTracker(reg, { generatedAt: at(48) });
  ok('eski kayıtta uyarı', old.includes('class="snap stale"') && old.includes('saat önce güncellendi'));
  ok('zamansız kayıtta uyarı', T.renderTracker({ ...reg, updated: 'bozuk' }, { generatedAt: NOW }).includes('Kayıt zamanı okunamadı'));
}

// ---- Kaçış ve maskeleme ----
{
  const evil = { updated: NOW, tasks: [{ local_session: 'x', state: 'running', title: '<script>alert(1)</script>', tests: '"><img src=x onerror=1>' }], roadmap: [] };
  const h = T.renderTracker(evil, { generatedAt: NOW });
  ok('başlık kaçışlı', !h.includes('<script>alert(1)') && h.includes('&lt;script&gt;'));
  ok('öznitelik kaçışı', !h.includes('<img src=x'));
  const fakeMap = 'pk.' + 'A'.repeat(30) + '.' + 'b'.repeat(14);
  const fakeG = 'AIza' + 'Q'.repeat(35);
  const leak = { updated: NOW, tasks: [{ local_session: 'y', state: 'completed', title: `jeton ${fakeMap} ve ${fakeG}`, tests: 'https://x.test/a?key=SAHTE123&b=1', note: 'Bearer abcdefghijklmnopq', deploy: 'ortam-degeri-SAHTE-999' }], roadmap: [] };
  const h2 = T.renderTracker(leak, { generatedAt: NOW, secrets: ['ortam-degeri-SAHTE-999'] });
  ok('Mapbox biçimli jeton maskelenir', !h2.includes(fakeMap));
  ok('Google biçimli anahtar maskelenir', !h2.includes(fakeG));
  ok('key= sorgu değeri maskelenir', !h2.includes('SAHTE123') && h2.includes('key=***'));
  ok('Bearer maskelenir', !h2.includes('abcdefghijklmnopq'));
  ok('ortam gizli değeri maskelenir', !h2.includes('ortam-degeri-SAHTE-999'));
  ok('UUID ve commit maskelenmez', T.redact('bae8d633-3093-4167-be2c-932d82446d80 44308a4') === 'bae8d633-3093-4167-be2c-932d82446d80 44308a4');
}

// ---- Kararlar / maketler (örnek veri; gerçek kayda yazılmaz) ----
{
  const dir = mkdtempSync(join(tmpdir(), 'evrf-tracker-'));
  try {
    writeFileSync(join(dir, 'a.png'), 'x');
    const fx = {
      updated: NOW, tasks: [], roadmap: [],
      decisions: [
        { id: 'D-1', date: '2026-11-08', title: 'Koyu öneri', status: 'superseded', superseded_by: 'D-2', area: 'general' },
        { id: 'D-2', date: '2026-11-10', title: 'Beyaz kart', status: 'implemented', history: [{ date: '2026-11-09', status: 'approved' }] },
        { id: 'D-3', date: '2026-11-13', title: 'Tema', status: 'approved' },
      ],
      mockups: [
        { id: 'M-A', title: 'Depoda', area: 'navigation', status: 'approved', asset: 'a.png' },
        { id: 'M-B', title: 'Dışarıda', area: 'charging', status: 'approved', asset: 'C:\\Users\\x\\b.png', external_location: 'orkestratör /mnt/data/b.png' },
        { id: 'M-C', title: 'Yok', area: 'route-planning', status: 'proposed', asset: 'yok.png' },
        { id: 'M-D', title: 'Kaçan', area: 'route-planning', status: 'proposed', asset: '../a.png' },
        { id: 'M-E', title: 'Url', area: 'charging', status: 'proposed', asset: 'https://x.test/a.png' },
      ],
    };
    const h = T.renderTracker(fx, { generatedAt: NOW, root: dir, outFile: 'a.html' });
    ok('kararlar yeniden eskiye', h.indexOf('D-3') < h.indexOf('D-2') && h.indexOf('D-2') < h.indexOf('D-1'));
    ok('yerini başkası alan karar soluk ve bağlı', h.includes('<tr class="old">') && h.includes('yerine: <code>D-2</code>'));
    ok('karar geçmişi korunur', h.includes('2026-11-09'));
    ok('olgunluk merdiveni', (h.match(/class="ladder"/g) || []).length >= 4);
    const sec = h.split('id="maketler"')[1].split('<section')[0];
    ok('depodaki görsel bağlantı', sec.includes('<img src="a.png"'));
    ok('mutlak yol bağlantı olmaz', !sec.includes('src="C:') && sec.includes('Görsel depoda yok'));
    ok('dış konum yalnızca metin', sec.includes('orkestratör /mnt/data/b.png') && !sec.includes('href="/mnt'));
    ok('olmayan dosya bağlantı olmaz', !sec.includes('yok.png"'));
    ok('depo dışına çıkan yol bağlantı olmaz', !sec.includes('../a.png"'));
    ok('url bağlantı olmaz', !sec.includes('https://x.test'));
    ok('alan başlıkları', ['Navigasyon', 'Rota planlama', 'Şarj'].every((a) => sec.includes(`<h3>${a}</h3>`)));
    ok('bilinmeyen durum merdivende değil', T.renderTracker({ updated: NOW, decisions: [{ id: 'Z', status: 'garip' }] }, { generatedAt: NOW }).includes('class="b b-garip"'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- Yayına girmeme ----
{
  ok('varsayılan çıktı local-test altında', T.DEFAULT_OUT.startsWith('local-test/'));
  ok('local-test git dışı', /^local-test\/$/m.test(read('.gitignore')));
  const items = (p) => (read(p).match(/const ITEMS = \[([^\]]*)\]/) || [])[1] ?? '';
  for (const p of ['scripts/build-beta.mjs', 'scripts/copy-www.mjs']) {
    const it = items(p);
    ok(`${p} docs/scripts/local-test paketlemez`, it.length > 0 && !/'(docs|scripts|local-test)'/.test(it), it);
  }
  ok('sw.js kabuğunda pano yok', !read('sw.js').includes('beta-takip'));
}

// ---- Komut satırı: kayıt dosyası değişmez ----
{
  const dir = mkdtempSync(join(tmpdir(), 'evrf-tracker-cli-'));
  try {
    const before = read('docs/beta-task-registry.json');
    const out = join(dir, 'pano.html');
    const msg = execFileSync(process.execPath, [fileURLToPath(new URL('./beta-tracker.mjs', import.meta.url)),'--out', out], { encoding: 'utf8' });
    ok('CLI çıktı yazar', existsSync(out) && readFileSync(out, 'utf8').includes('Beta Proje Takibi'), msg);
    ok('kayıt dosyası değişmez', read('docs/beta-task-registry.json') === before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail) process.exit(1);
