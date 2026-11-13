// Beta Proje Takibi: docs/beta-task-registry.json'dan tek dosyalık, iç kullanım HTML panosu üretir.
// Kullanım: node scripts/beta-tracker.mjs [--registry docs/beta-task-registry.json] [--out local-test/beta-takip.html]
//
// Kurallar:
// - Salt okunur: kayıt dosyasını değiştirmez. Veri uydurmaz; kayıtta olmayan bölüm "kayıtta yok" diye görünür.
// - Canlı değil: pano bir anlık görüntüdür. Üstte kayıt zamanı ve üretim zamanı yazar; yenilemek için komut yeniden çalıştırılır.
// - Yayımlanmaz: çıktı varsayılan olarak git dışı local-test/ altına yazılır. build-beta.mjs ve copy-www.mjs bu dosyayı paketlemez.
// - Ağ yok, dış kaynak yok, betik yok. Tüm metinler HTML kaçışlıdır; anahtar biçimli dizeler maskelenir.
// - Durum yükseltilmez: "verified" / "device-verified" yalnızca kayıtta öyle yazıyorsa gösterilir.
//
// İsteğe bağlı kayıt alanları (henüz kayıtta yoksa ilgili bölüm boş kalır; ekleme kayıt görevinin işidir):
//   decisions[]: { id, date, title, area?, status: proposed|approved|implemented|device-verified|superseded|rejected,
//                  source?, evidence?, superseded_by?, history?: [{ date, status, note? }] }
//   mockups[]:   { id, title, area: navigation|route-planning|charging|general, status, date?,
//                  asset?: depo-göreli yol (yalnızca dosya depoda varsa bağlantı olur), external_location?, note? }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_REGISTRY = 'docs/beta-task-registry.json';
export const DEFAULT_OUT = 'local-test/beta-takip.html';
export const STALE_HOURS = 24;

export const TASK_STATES = ['queued', 'running', 'completed', 'verified', 'no-change', 'failed', 'unknown'];
export const LADDER = ['proposed', 'approved', 'implemented', 'device-verified'];
const STATE_TR = {
  planned: 'planlandı', queued: 'kuyrukta', running: 'çalışıyor', completed: 'tamamlandı (doğrulanmadı)',
  verified: 'doğrulandı', failed: 'başarısız', 'no-change': 'değişiklik yok', unknown: 'bilinmiyor', partial: 'kısmi',
  proposed: 'önerildi', approved: 'onaylandı', implemented: 'uygulandı', 'device-verified': 'cihazda doğrulandı',
  superseded: 'yerini başkası aldı', rejected: 'reddedildi',
};
const AREA_TR = { navigation: 'Navigasyon', 'route-planning': 'Rota planlama', charging: 'Şarj', general: 'Genel' };
const PRIO = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** HTML kaçışı. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Anahtar/jeton biçimli dizeleri maskeler (Mapbox pk./sk., Google AIza, Bearer, key=/token= sorgu değerleri, ortamdaki gizli değerler). */
export function redact(s, secrets = []) {
  let t = String(s ?? '');
  for (const v of secrets) if (v && v.length >= 6) t = t.split(v).join('***');
  return t
    .replace(/\b(?:pk|sk|tk)\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '***')
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, '***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer ***')
    .replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&\s"'<>]+/gi, '$1***');
}

/** Bir maket varlığı yalnızca depo içinde, göreli ve gerçekten var olan bir dosyaysa bağlantı olur. */
export function assetHref(asset, { root = ROOT, outFile } = {}) {
  if (!asset || typeof asset !== 'string') return null;
  if (isAbsolute(asset) || /^[a-z]+:/i.test(asset) || asset.startsWith('%') || asset.startsWith('~')) return null;
  const abs = resolve(root, asset);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  if (!existsSync(abs)) return null;
  const from = outFile ? dirname(resolve(root, outFile)) : root;
  return relative(from, abs).split(sep).join('/');
}

const list = (a) => (Array.isArray(a) ? a : []);
const short = (id) => (typeof id === 'string' && /^[0-9a-f]{8}-/.test(id) ? id.slice(0, 8) : id);

/** Kayıttaki tüm Claude görevleri (yerel oturum + yalnızca orkestratör) tek düz listede. */
export function allTasks(reg) {
  const local = list(reg.tasks).map((t) => ({ ...t, _id: t.local_session, _src: 'yerel oturum' }));
  const orch = list(reg.orchestrator_only_tasks).map((t) => ({ ...t, title: t.title ?? t.subject, _id: t.orchestrator_id, _src: 'orkestratör' }));
  return [...local, ...orch];
}

/** Durum sayıları. Kayıtta olmayan durumlar 0'dır; hiçbir şey yükseltilmez. */
export function countStates(reg) {
  const c = Object.fromEntries(TASK_STATES.map((s) => [s, 0]));
  for (const t of allTasks(reg)) c[t.state] = (c[t.state] ?? 0) + 1;
  return c;
}

export function ageHours(updated, now) {
  const u = Date.parse(updated);
  return Number.isFinite(u) ? (Date.parse(now) - u) / 3600e3 : null;
}

/** Sonraki öncelikler: tamamlanmamış/doğrulanmamış yol haritası maddeleri, öncelik ve kimliğe göre. */
export function nextPriorities(reg) {
  return list(reg.roadmap)
    .filter((r) => !['verified', 'completed'].includes(r.status))
    .sort((a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9) || String(a.id).localeCompare(String(b.id)));
}

/** Engeller: başarısız/bilinmeyen görevler ve açık kalanı olan yol haritası maddeleri. */
export function blockers(reg) {
  const tasks = allTasks(reg).filter((t) => ['failed', 'unknown'].includes(t.state));
  const road = list(reg.roadmap).filter((r) => r.open || /insan|human|legal|hukuk|onay/i.test(`${r.status} ${r.note ?? ''}`));
  return { tasks, road };
}

function badge(s) {
  const k = String(s ?? 'unknown').split(' ')[0];
  return `<span class="b b-${esc(k.replace(/[^a-z-]/gi, ''))}" title="${esc(s)}">${esc(STATE_TR[k] ?? s ?? '—')}</span>`;
}
function ladder(status) {
  const i = LADDER.indexOf(status);
  if (i < 0) return badge(status);
  return `<span class="ladder">${LADDER.map((s, j) => `<span class="${j <= i ? 'on' : ''}">${esc(STATE_TR[s])}</span>`).join('')}</span>`;
}
const txt = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join('; ') : typeof v === 'object' && v ? JSON.stringify(v) : v);
const cell = (v, R) => esc(R(txt(v) ?? '')) || '—';
const ids = (a, R) => list(a).map((x) => `<code>${esc(R(short(typeof x === 'object' ? x.id : x)))}</code>`).join(' ') || '—';
const empty = (msg) => `<p class="empty">${esc(msg)}</p>`;

/**
 * Saf işleyici. reg: kayıt nesnesi. opts.generatedAt: ISO zaman (belirlenimci test için).
 * opts.secrets: maskelenecek gizli değerler. opts.root/outFile: maket bağlantı denetimi için.
 */
export function renderTracker(reg, opts = {}) {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const R = (s) => redact(s, opts.secrets ?? []);
  const C = (v) => cell(v, R);
  const age = ageHours(reg.updated, generatedAt);
  const stale = age == null || age > (opts.staleHours ?? STALE_HOURS);
  const counts = countStates(reg);
  const tasks = allTasks(reg);
  const out = [];

  out.push(`<header><h1>Beta Proje Takibi</h1>
<p class="scope">${C(reg.scope)}</p>
<div class="snap${stale ? ' stale' : ''}">
<b>Anlık görüntü, canlı değil.</b> Kayıt zamanı: <code>${C(reg.updated)}</code> · kaynak HEAD <code>${C(reg.source_head_at_update)}</code> · uygulama v${C(reg.app_version_at_update)} · pano üretimi: <code>${esc(generatedAt)}</code>
${age == null ? '<br>Kayıt zamanı okunamadı.' : stale ? `<br><b>Uyarı:</b> kayıt ${Math.round(age)} saat önce güncellendi; durumlar eskimiş olabilir.` : ''}
<br>Yenilemek için: <code>node scripts/beta-tracker.mjs</code> (önce kaydı güncelleyin: <code>${esc(DEFAULT_REGISTRY)}</code>).
</div>
<p class="counts">${TASK_STATES.map((s) => `${badge(s)} ${counts[s]}`).join(' · ')}</p>
<nav>${['kararlar', 'maketler', 'planlanan', 'gorevler', 'engeller', 'oncelikler', 'sozluk'].map((a) => `<a href="#${a}">${a}</a>`).join(' · ')}</nav>
</header>`);

  // 1. Onaylı kararlar
  const dec = list(reg.decisions).slice().sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  out.push(`<section id="kararlar"><h2>Kararlar</h2>`);
  out.push(dec.length
    ? `<table><tr><th>Tarih</th><th>Karar</th><th>Alan</th><th>Durum</th><th>Kanıt / kaynak</th><th>Geçmiş</th></tr>${dec.map((d) => `<tr${d.status === 'superseded' || d.status === 'rejected' ? ' class="old"' : ''}><td>${C(d.date)}</td><td><code>${C(d.id)}</code> ${C(d.title)}</td><td>${esc(AREA_TR[d.area] ?? d.area ?? '—')}</td><td>${ladder(d.status)}${d.superseded_by ? `<br>yerine: ${ids([d.superseded_by].flat(), R)}` : ''}</td><td>${C(d.evidence ?? d.source)}</td><td>${list(d.history).map((h) => `${C(h.date)} ${badge(h.status)} ${C(h.note)}`).join('<br>') || '—'}</td></tr>`).join('')}</table>`
    : empty('Kayıtta karar listesi (decisions) yok. Kararlar kayıt görevi tarafından eklenene kadar burada gösterilmez; uydurulmaz.'));
  out.push('</section>');

  // 2. Tasarım maketleri
  const mk = list(reg.mockups);
  out.push(`<section id="maketler"><h2>Tasarım maketleri</h2>`);
  if (!mk.length) out.push(empty('Kayıtta maket listesi (mockups) yok. Görsel yalnızca depoda gerçekten varsa bağlantı olarak gösterilir.'));
  for (const area of ['navigation', 'route-planning', 'charging', 'general']) {
    const rows = mk.filter((m) => (AREA_TR[m.area] ? m.area : 'general') === area);
    if (!rows.length) continue;
    out.push(`<h3>${AREA_TR[area]}</h3><table><tr><th>Maket</th><th>Durum</th><th>Görsel</th><th>Not</th></tr>${rows.map((m) => {
      const href = assetHref(m.asset, { root: opts.root ?? ROOT, outFile: opts.outFile ?? DEFAULT_OUT });
      const img = href
        ? `<a href="${esc(href)}"><img src="${esc(href)}" alt="${esc(R(m.title))}" loading="lazy"></a>`
        : `<span class="missing">Görsel depoda yok${m.external_location ? `; bilinen konum (bağlantı değil): <code>${C(m.external_location)}</code>` : ''}</span>`;
      return `<tr><td><code>${C(m.id)}</code> ${C(m.title)}${m.date ? `<br><small>${C(m.date)}</small>` : ''}</td><td>${ladder(m.status)}</td><td>${img}</td><td>${C(m.note)}</td></tr>`;
    }).join('')}</table>`);
  }
  out.push('</section>');

  // 3. Planlanan (görev verilmemiş)
  const planned = list(reg.roadmap).filter((r) => String(r.status).startsWith('planned'));
  out.push(`<section id="planlanan"><h2>Planlanan, görev olarak verilmemiş</h2>`);
  out.push(planned.length
    ? `<table><tr><th>RM</th><th>Başlık</th><th>Öncelik</th><th>Durum</th><th>Bağımlı</th><th>Not</th></tr>${planned.map((r) => `<tr><td><code>${C(r.id)}</code></td><td>${C(r.title)}</td><td>${C(r.priority)}</td><td>${badge(r.status)}</td><td>${C(r.depends_on)}</td><td>${C(r.note ?? r.current_state)}</td></tr>`).join('')}</table>`
    : empty('Planlanan madde yok.'));
  out.push('</section>');

  // 4. Claude görevleri durumlara göre
  out.push(`<section id="gorevler"><h2>Claude görevleri</h2><p class="note">"tamamlandı" = görev kendi raporunda commit ve test bildirdi; cihazda ya da kullanıcı tarafından doğrulanmadı. "doğrulandı" yalnızca kayıtta öyle yazıyorsa görünür.</p>`);
  for (const s of TASK_STATES) {
    const rows = tasks.filter((t) => t.state === s);
    out.push(`<details${['queued', 'running'].includes(s) ? ' open' : ''}><summary>${badge(s)} ${rows.length}</summary>`);
    out.push(rows.length
      ? `<table><tr><th>Kimlik</th><th>Başlangıç</th><th>Görev</th><th>Commit / sürüm</th><th>Test (bildirilen)</th><th>Yayın</th><th>RM</th><th>Bağlantılar</th></tr>${rows.map((t) => `<tr><td><code title="${esc(R(t._id))}">${C(t._id)}</code><br><small>${t._src}${t.orchestrator_id && t._src !== 'orkestratör' ? ` · ork. <code>${C(t.orchestrator_id)}</code> (${C(t.orchestrator_mapping_confidence)})` : ''}${list(t.orchestrator_id_candidates).length ? ` · aday ${list(t.orchestrator_id_candidates).map((c) => `<code>${C(short(c.id))}</code> (${C(c.confidence)})`).join(' ')}` : ''}</small></td><td>${C(t.started)}</td><td>${C(t.title)}${t.failure ? `<br><small>neden: ${C(t.failure)}</small>` : ''}</td><td>${t.commit ? `<code>${C(t.commit)}</code>` : '—'}${t.version ? ` v${C(t.version)}` : ''}${list(t.replaced_by_commits).length ? `<br>yerine commit: ${ids(t.replaced_by_commits, R)}` : ''}</td><td>${C(t.tests)}</td><td>${C(t.deploy)}</td><td>${C(t.roadmap)}</td><td>${t.replaces ? `yerine geçtiği: ${ids([t.replaces].flat(), R)}<br>` : ''}${list(t.replaced_by).length ? `yerini alan: ${ids(t.replaced_by, R)}<br>` : ''}${list(t.reconciled_by).length ? `uzlaştıran: ${ids(t.reconciled_by, R)}<br>` : ''}${C(t.open ?? t.note ?? t.link)}</td></tr>`).join('')}</table>`
      : empty(s === 'verified' ? 'Kayıtta doğrulanmış görev yok.' : 'Yok.'));
    out.push('</details>');
  }
  out.push('</section>');

  // 5. Engeller
  const bl = blockers(reg);
  out.push(`<section id="engeller"><h2>Engeller ve açık kalanlar</h2>`);
  out.push(bl.tasks.length
    ? `<h3>Başarısız / sonucu bilinmeyen görevler</h3><ul>${bl.tasks.map((t) => `<li>${badge(t.state)} <code>${C(short(t._id))}</code> ${C(t.title)}: ${C(t.open ?? t.note ?? t.failure)}${list(t.replaced_by).length ? ` · yerini alan ${ids(t.replaced_by, R)}` : ''}</li>`).join('')}</ul>`
    : empty('Başarısız ya da bilinmeyen görev yok.'));
  out.push(bl.road.length
    ? `<h3>Yol haritasında açık kalanlar</h3><ul>${bl.road.map((r) => `<li><code>${C(r.id)}</code> ${C(r.title)} ${badge(r.status)}: ${C(r.open ?? r.note)}</li>`).join('')}</ul>`
    : '');
  out.push('</section>');

  // 6. Sonraki öncelikler
  const np = nextPriorities(reg);
  out.push(`<section id="oncelikler"><h2>Sonraki öncelikler</h2><p class="note">Sıra kayıttaki önceliğe göredir (P0 önce); bu pano öncelik belirlemez.</p>`);
  out.push(np.length
    ? `<ol>${np.map((r) => `<li><b>${C(r.priority)}</b> <code>${C(r.id)}</code> ${C(r.title)} ${badge(r.status)}${list(r.depends_on).length ? ` · bağımlı: ${C(r.depends_on)}` : ''}${list(r.linked_tasks).length ? ` · görevler: ${ids(r.linked_tasks, R)}` : ''}</li>`).join('')}</ol>`
    : empty('Açık madde yok.'));
  out.push('</section>');

  // 7. Durum sözlüğü
  const voc = reg.status_vocabulary ?? {};
  out.push(`<section id="sozluk"><h2>Durum sözlüğü</h2><p>Olgunluk sırası (kararlar ve maketler): ${LADDER.map((s) => esc(STATE_TR[s])).join(' → ')}</p><table>${Object.entries(voc).map(([k, v]) => `<tr><td>${badge(k)}</td><td>${C(v)}</td></tr>`).join('')}</table><p class="note">${C(reg.id_notes)}</p></section>`);

  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'">
<title>Beta Proje Takibi (iç kullanım)</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1200px;padding:16px;color:#1b2333;background:#f6f7fb}
h1{margin:0 0 4px}h2{margin-top:28px;border-bottom:2px solid #1b3a6b;padding-bottom:4px}
table{border-collapse:collapse;width:100%;background:#fff;margin:8px 0}td,th{border:1px solid #d7dce6;padding:5px 7px;vertical-align:top;text-align:left}
th{background:#eef1f7}code{font-size:12px;background:#eef1f7;padding:0 3px;border-radius:3px;word-break:break-all}
.snap{background:#e8f0ff;border:1px solid #9bb6e8;padding:8px 10px;border-radius:6px}.snap.stale{background:#fff4e0;border-color:#e0a84a}
.b{display:inline-block;padding:1px 7px;border-radius:9px;font-size:12px;background:#e3e6ec;white-space:nowrap}
.b-running{background:#cfe3ff}.b-queued{background:#efe3ff}.b-completed,.b-implemented{background:#d9f2df}.b-verified,.b-device-verified{background:#1f7a3a;color:#fff}
.b-failed{background:#ffd6d6}.b-unknown{background:#f3e3b5}.b-planned,.b-proposed{background:#eceff3}.b-partial,.b-approved{background:#fff0c2}
.ladder span{display:inline-block;padding:1px 6px;font-size:11px;border:1px solid #c8ced9;color:#8a93a3}.ladder span.on{background:#1b3a6b;color:#fff;border-color:#1b3a6b}
tr.old{opacity:.6}.empty,.missing{color:#8a5a00;font-style:italic}.note{color:#555}img{max-width:220px;height:auto;border:1px solid #ccd}
details{margin:6px 0}summary{cursor:pointer;font-weight:600}
</style></head><body>
${out.join('\n')}
<footer class="note">İç kullanım. Yayımlanmaz: Beta paketine ve üretim sitesine girmez. Kaynak: <code>${esc(DEFAULT_REGISTRY)}</code>.</footer>
</body></html>
`;
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const regPath = arg('--registry', DEFAULT_REGISTRY);
  const outPath = arg('--out', DEFAULT_OUT);
  const reg = JSON.parse(readFileSync(resolve(ROOT, regPath), 'utf8'));
  // Yalnızca o anki süreç ortamındaki gizli değerler maskelenir; server/.env okunmaz.
  const { secretValues } = await import('../server/scrub.mjs');
  const html = renderTracker(reg, { secrets: secretValues(process.env), outFile: outPath });
  const abs = resolve(ROOT, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html);
  const c = countStates(reg);
  console.log(`Beta Proje Takibi yazıldı: ${relative(ROOT, abs)} (kayıt ${reg.updated}; ${TASK_STATES.map((s) => `${s} ${c[s]}`).join(', ')})`);
}
