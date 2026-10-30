/** Sürüm numarası (üst çubukta) ve sürüm notları penceresi. Kaynak: version.js (klasik betik, globalThis'e yazar). */
export const APP_VERSION = globalThis.APP_VERSION || '?';

export function initVersionInfo() {
  const $ = (id) => document.getElementById(id);
  const log = globalThis.APP_CHANGELOG || [];
  $('btn-version').textContent = 'v' + APP_VERSION;

  const list = $('changelog');
  list.replaceChildren();
  log.forEach((entry) => {
    const h = document.createElement('h3');
    h.textContent = `v${entry.v} · ${entry.date}`;
    const ul = document.createElement('ul');
    entry.notes.forEach((n) => ul.append(Object.assign(document.createElement('li'), { textContent: n })));
    list.append(h, ul);
  });
  $('about-version').textContent = 'v' + APP_VERSION;

  const dlg = $('about-dialog');
  $('btn-version').addEventListener('click', () => dlg.showModal());
  $('about-close').addEventListener('click', () => dlg.close());
}
