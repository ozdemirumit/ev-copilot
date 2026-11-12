// Rota sayfası: "Rota seçeneklerini karşılaştır" katlanır bölümü. Yalnızca açıkken hesaplanır (planlayıcı her mod için ağsız yeniden çalışır).
// Seçili modun satırı haritadaki mevcut planın kendisidir (aynı başlangıç km/pil ve ilk durak sınırıyla kurulan diğer modlarla karşılaştırılır).
// "Bunu kullan" planlayıcı modunu değiştirir: İstasyon sekmesindeki mod çipleriyle aynı yol (save planMode + patch plan.mode → denetleyici yeniden planlar).
import { getState, patch, subscribe } from '../state.js';
import { save } from '../utils/storage.js';
import { routeOptionPlans } from '../routing/controller.js';
import { buildRouteOptions, optionText, OPTION_MODES } from '../routing/routeOptions.js';

export const PRICE_NOTE = 'Fiyat: "tarife" işletmecinin liste/yayımlanan ya da senin girdiğin kWh fiyatıdır; "tahmini" bilinmeyen işletmeci için ortalamadır; bilinmeyen fiyat tutara eklenmez. Süre ve pil tahmindir.';

/** Seçili mod için mevcut plan + diğer modlar için ağsız planlar. Mevcut plan durumuna yazmaz. */
export function optionPlans(p, getPlans = routeOptionPlans) {
  let plans = {};
  try { plans = getPlans(OPTION_MODES.filter((m) => m !== p.mode)) || {}; } catch { plans = {}; }
  plans[p.mode] = { feasible: true, stops: p.stops || [], totals: p.totals }; // seçili mod: gösterilen planın kendisi
  return plans;
}

/** Modeli verilen kutuya çizer. onUse(mode) "Bunu kullan" düğmesinde çağrılır. */
export function renderRouteOptions(body, model, onUse, doc = document) {
  const el = (tag, cls, text) => Object.assign(doc.createElement(tag), { className: cls || '', textContent: text ?? '' });
  const cur = model.options.find((o) => o.current);
  const curLead = cur ? cur.sameAs || cur.mode : null;
  body.replaceChildren();
  body.append(el('p', 'small muted', model.routes.note));
  for (const o of model.options) {
    const tx = optionText(o, model);
    const row = el('div', 'stop ro-row');
    row.dataset && (row.dataset.mode = o.mode);
    row.append(el('div', 't', tx.title), el('div', 'r', tx.badges.join(' · ')), el('div', 'm', tx.line));
    if (tx.risk) row.append(el('div', 'm', tx.risk));
    if (!o.current && o.feasible) {
      if ((o.sameAs || o.mode) === curLead) row.append(el('div', 'm', 'Seçili planla aynı.'));
      else {
        const use = el('button', 'btn ghost sm ro-use', 'Bunu kullan');
        use.type = 'button';
        use.addEventListener('click', () => onUse(o.mode));
        row.append(use);
      }
    }
    body.append(row);
  }
  body.append(
    el('p', 'small muted', 'En hızlı: ' + model.notes.fast),
    el('p', 'small muted', 'En ucuz: ' + model.notes.cheap),
    el('p', 'small muted', 'En düşük risk: ' + model.notes.risk),
    el('p', 'small muted', PRICE_NOTE),
  );
}

/** Planlayıcı modunu değiştirir (İstasyon sekmesi çipleriyle aynı akış). */
export function useMode(mode) {
  if (!OPTION_MODES.includes(mode) || getState('plan').mode === mode) return;
  save('planMode', mode);
  patch('plan', { mode }); // denetleyici mod değişimini dinler ve yeniden planlar
}

export function initRouteOptionsView({ doc = document, getPlans = routeOptionPlans } = {}) {
  const box = doc.getElementById('route-options');
  const body = doc.getElementById('ro-body');
  if (!box || !body) return null;
  let key = null;

  function paint() {
    const p = getState('plan');
    const ready = p.status === 'ready' && !!p.profile && !!p.totals;
    box.classList.toggle('hidden', !ready);
    if (!ready) { key = null; return; }
    if (!box.open) return;
    const k = [p.mode, p.fromKm ?? 0, p.fromSoc ?? '', p.maxFirstStopKm ?? '', p.stations?.length ?? 0, (p.pinIds || []).join(','), (p.banIds || []).join(','),
      (p.stops || []).map((s) => s.station?.id).join(','), Math.round(p.totals?.totalMin ?? 0)].join('|');
    if (k === key) return;
    key = k;
    const model = buildRouteOptions({ plans: optionPlans(p, getPlans), route: p.route, current: p.mode });
    renderRouteOptions(body, model, useMode, doc);
  }

  box.addEventListener('toggle', paint);
  subscribe('plan', paint);
  paint();
  return { paint };
}
