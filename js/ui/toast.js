let timer;

export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), ms);
}
