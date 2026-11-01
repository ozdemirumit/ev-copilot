import { getState, patch, subscribe } from '../state.js';
import { DEFAULT_SIM } from '../config.js';
import { save } from '../utils/storage.js';
import { resetSimPosition } from '../sim/simulator.js';
import { toast } from './toast.js';
import { startNav, stopNav } from '../nav/navigator.js';

const SLIDER_KEYS = ['speed', 'soc', 'grade', 'heading', 'windSpeed', 'windDir', 'rain', 'traffic', 'temp'];

export function initTestPanel() {
  const $ = (id) => document.getElementById(id);
  const toggle = $('sim-enabled');
  const banner = $('sim-banner');
  const badge = $('bd-sim');
  const play = $('sim-play');
  const scale = $('sim-timescale');
  const sliders = [...document.querySelectorAll('input[data-sim]')];

  const outFor = (key) => document.querySelector(`output[data-out="${key}"]`);
  const persist = () => {
    const sim = getState('sim');
    save('sim', Object.fromEntries([...SLIDER_KEYS, 'timeScale'].map((k) => [k, sim[k]])));
  };

  function paintValues(onlyIdle = false) {
    const sim = getState('sim');
    sliders.forEach((s) => {
      const k = s.dataset.sim;
      if (onlyIdle && document.activeElement === s) return; // kullanıcı sürüklerken ezme
      s.value = sim[k];
      outFor(k).textContent = Math.round(sim[k] * 10) / 10 + s.dataset.unit;
    });
  }

  function paintState() {
    const sim = getState('sim');
    toggle.checked = sim.enabled;
    banner.classList.toggle('hidden', !sim.enabled);
    badge.classList.toggle('hidden', !sim.enabled);
    document.body.classList.toggle('sim-on', sim.enabled);
    play.textContent = sim.play ? '⏸ Durdur' : '▶ Oynat';
    play.classList.toggle('sel', sim.play);
    scale.value = String(sim.timeScale);
    const total = getState('plan').profile?.totalKm;
    $('sim-pos').textContent = total ? `${(sim.routeKm ?? 0).toFixed(1)} / ${total.toFixed(0)} km` : 'rota yok (gidiş açısı yönünde ilerler)';
  }

  sliders.forEach((s) =>
    s.addEventListener('input', () => {
      patch('sim', { [s.dataset.sim]: Number(s.value) });
      outFor(s.dataset.sim).textContent = s.value + s.dataset.unit;
      persist();
    })
  );

  let navByTest = false; // navigasyonu Test Modu açtıysa, Test Modu kapanınca o da kapanır
  toggle.addEventListener('change', () => {
    patch('sim', { enabled: toggle.checked, play: toggle.checked ? getState('sim').play : false });
    if (!toggle.checked && navByTest) { navByTest = false; if (getState('nav').active) stopNav(); }
  });

  play.addEventListener('click', () => {
    const sim = getState('sim');
    if (!sim.enabled) return toast('Önce Test Modu\'nu aç');
    const starting = !sim.play; // patch aynı nesneyi günceller: önceki değer burada saklanır
    patch('sim', { play: starting });
    // Oynatınca gerçek navigasyon gibi başlar: navigasyon ekranı, yönlendirme, ses ve rota takibi (plan varsa; yoksa uyarı çıkar)
    if (starting && !getState('nav').active) { navByTest = true; startNav(); }
  });
  scale.addEventListener('change', () => { patch('sim', { timeScale: Number(scale.value) || 10 }); persist(); });
  $('sim-reset-pos').addEventListener('click', resetSimPosition);

  $('sim-reset').addEventListener('click', () => {
    const { enabled, play: _p, timeScale, lat, lon, routeKm, ...defaults } = DEFAULT_SIM;
    patch('sim', defaults);
    paintValues();
    persist();
  });

  subscribe('sim', () => { paintState(); paintValues(true); });
  subscribe('plan', paintState);
  paintValues();
  paintState();
}
