// Kartları başlıklarındaki +/− düğmesiyle açıp kapatır. Durum cihazda saklanır (evcp.collapsed).
// Kart HTML'inde data-collapsed="1" varsa ilk açılışta kapalı gelir; kullanıcı bir kez değiştirince seçimi hatırlanır.
import { load, save } from '../utils/storage.js';
import { tr } from '../i18n/index.js';

const state = load('collapsed', {});

function set(card, btn, title, closed) {
  card.classList.toggle('collapsed', closed);
  btn.textContent = closed ? '+' : '−';
  btn.setAttribute('aria-expanded', String(!closed));
  btn.setAttribute('aria-label', tr(closed ? 'Aç:' : 'Kapat:') + ' ' + title);
}

export function initCollapse() {
  document.querySelectorAll('.card').forEach((card) => {
    const heading = card.querySelector('h2, h3');
    if (!heading || heading.closest('.card') !== card) return; // başlıksız (metrik/sürgü) kartlar
    const key = card.id || heading.id || `${card.closest('.tab')?.id}:${heading.textContent.trim()}`; // metni değişen başlıklar id ile

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tog';

    // Başlık kartın doğrudan çocuğuysa sağa düğme için sarmalanır; bir satırın (rozet vb.) içindeyse
    // yalnızca başlık+düğme grubu yapılır ki satırın düzeni bozulmasın.
    const direct = heading.parentElement === card;
    const group = document.createElement(direct ? 'div' : 'span');
    group.className = direct ? 'card-head' : 'hd-grp';
    heading.replaceWith(group);
    group.append(heading, btn);
    const head = direct ? group : heading.closest('.card > *');
    head.classList.add('card-head-row');

    const closed = () => card.classList.contains('collapsed');
    const saved = state[key];
    const title = heading.textContent.trim();
    set(card, btn, title, saved === undefined ? card.dataset.collapsed === '1' : saved);
    btn.addEventListener('click', () => {
      set(card, btn, title, !closed());
      state[key] = closed();
      save('collapsed', state);
    });
  });
}
