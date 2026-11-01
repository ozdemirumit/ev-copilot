import { locale } from '../i18n/index.js';
import { CATS, getUsage, subscribeUsage, resetUsage, sum } from '../net/meter.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);

export function fmtBytes(n) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`;
}

const cell = (text, cls) => Object.assign(document.createElement('td'), { textContent: text, className: cls || '' });

/** Üst çubuktaki veri rozeti + ayrıntı penceresi (kategori dökümü, bu oturum, sıfırlama). */
export function initDataUsage() {
  const badge = $('btn-data');
  const dlg = $('data-dialog');
  const body = $('usage-body');
  const resetBtn = $('usage-reset');
  let armed = null;

  function paint() {
    const { total, session } = getUsage();
    const t = sum(total);
    badge.textContent = `📶 ↑${fmtBytes(t.up)} ↓${fmtBytes(t.down)}`;
    if (!dlg.open) return;

    body.replaceChildren();
    Object.entries(CATS).forEach(([key, name]) => {
      const c = total.cats[key];
      if (!c.n) return;
      const tr = document.createElement('tr');
      tr.append(cell(name + (c.est ? ' ≈' : '')), cell(fmtBytes(c.up), 'num'), cell(fmtBytes(c.down), 'num'), cell(String(c.n), 'num'));
      body.append(tr);
    });
    if (!body.children.length) {
      const tr = document.createElement('tr');
      const td = cell('Henüz veri yok');
      td.colSpan = 4;
      tr.append(td);
      body.append(tr);
    }
    const s = sum(session);
    $('usage-total').textContent = `↑ ${fmtBytes(t.up)}  ↓ ${fmtBytes(t.down)}  (toplam ${fmtBytes(t.up + t.down)}) · ${t.n} istek`;
    $('usage-session').textContent = `↑ ${fmtBytes(s.up)}  ↓ ${fmtBytes(s.down)}  (toplam ${fmtBytes(s.up + s.down)})`;
    $('usage-since').textContent = new Date(total.since).toLocaleString(locale());
  }

  badge.addEventListener('click', () => { dlg.showModal(); paint(); });
  $('usage-close').addEventListener('click', () => dlg.close());

  // Yanlışlıkla sıfırlamayı önlemek için iki dokunuş
  resetBtn.addEventListener('click', () => {
    if (!armed) {
      resetBtn.textContent = 'Emin misin? Tekrar dokun';
      resetBtn.classList.add('danger');
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    resetUsage();
    toast('Veri sayaçları sıfırlandı');
  });
  function disarm() {
    clearTimeout(armed);
    armed = null;
    resetBtn.textContent = 'Sayaçları sıfırla';
    resetBtn.classList.remove('danger');
  }
  dlg.addEventListener('close', disarm);

  subscribeUsage(paint);
  paint();
}
