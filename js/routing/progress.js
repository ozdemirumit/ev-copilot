// Planda araç nerede? Gerçek ilerleme yalnızca navigasyon açıkken ya da araç hareket ederken ve rotanın üzerindeyken sayılır.
// Park halindeyken (örneğin rotayı evden önizlerken ya da konum rotanın sonundayken) plan başından gösterilir: duraklar "geride kaldı" diye gizlenmez.
import { getState, effective } from '../state.js';

const ON_ROUTE_KM = 3;

export function progressKm() {
  const plan = getState('plan');
  const eng = getState('engine');
  const moving = getState('nav').active || (effective().speed ?? 0) > 5;
  const on = eng.routeKm != null && (eng.offRouteKm ?? Infinity) <= ON_ROUTE_KM && moving;
  return on ? eng.routeKm : plan.fromKm ?? 0;
}
