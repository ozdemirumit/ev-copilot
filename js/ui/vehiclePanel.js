import { getState, patch, subscribe } from '../state.js';
import { save, remove } from '../utils/storage.js';
import { VEHICLE, VEHICLES, PHYSICS, PLANNER } from '../config.js';
import { kwhPer100 } from '../physics/model.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const FIELDS = { batteryNetKwh: 'veh-bat', massKg: 'veh-mass', cd: 'veh-cd', frontalAreaM2: 'veh-area', maxDcKw: 'veh-dc' };

/** Araç seçimi/özel değerler, tüketim düzeltmesi ve plan payları (varış/şarj hedefi). */
export function initVehiclePanel() {
  // ---- Araç: değişince sayfa yenilenir (modüller batarya vb. değerleri başlangıçta okur)
  const sel = $('veh-select');
  VEHICLES.forEach((v) => sel.append(new Option(v.name, v.id)));
  sel.value = VEHICLE.id;

  const fill = (spec) => Object.entries(FIELDS).forEach(([k, id]) => { $(id).value = spec[k]; });
  fill(VEHICLE);

  sel.addEventListener('change', () => fill(VEHICLES.find((v) => v.id === sel.value)));
  // Bir değeri elle değiştirmek hazır aracı "Özel araç" yapar
  Object.values(FIELDS).forEach((id) => $(id).addEventListener('input', () => { sel.value = 'custom'; }));

  $('veh-apply').addEventListener('click', () => {
    const spec = { name: VEHICLES.find((v) => v.id === sel.value).name };
    for (const [k, id] of Object.entries(FIELDS)) {
      const n = Number($(id).value);
      if (!(n > 0)) return toast('Araç değerleri geçersiz');
      spec[k] = n;
    }
    const busy = getState('system').ocr || getState('plan').status === 'ready';
    if (busy && !confirm('Araç değişince sayfa yenilenir; aktif plan ve OCR sıfırlanır. Devam edilsin mi?')) return;
    save('vehicle', { id: sel.value, spec });
    remove('kCal'); // önceki araca ait öğrenilmiş tüketim düzeltmesi geçersiz
    location.reload();
  });

  // ---- Tüketim düzeltmesi
  const adj = $('cons-adj');
  const target = $('cons-target');
  const info = $('cons-info');
  const base = () => kwhPer100({ v: getState('route').cruise, temp: 15 }) / PHYSICS.consScale; // düzeltmesiz model

  function paintCons({ fromTarget = false } = {}) {
    const cruise = getState('route').cruise;
    const adjusted = base() * PHYSICS.consScale;
    $('cons-adj-out').textContent = `%${adj.value > 0 ? '+' : ''}${adj.value}`;
    info.textContent = `Model tahmini ${base().toFixed(1)} kWh/100 km (${cruise} km/h, düz yol, 15 °C, rüzgârsız); düzeltmeyle ${adjusted.toFixed(1)} kWh/100 km.`;
    if (!fromTarget) target.value = adjusted.toFixed(1);
  }

  function setAdj(percent, opts) {
    const p = Math.round(Math.min(100, Math.max(-30, percent)));
    adj.value = p;
    PHYSICS.consScale = 1 + p / 100;
    save('consAdj', p);
    patch('route', { consAdj: p }); // plan/menzil yeniden hesaplanır
    paintCons(opts);
  }

  adj.value = getState('route').consAdj;
  adj.addEventListener('input', () => setAdj(Number(adj.value)));
  target.addEventListener('change', () => {
    const v = Number(target.value);
    if (!(v > 0)) return paintCons();
    setAdj((v / base() - 1) * 100);
  });
  subscribe('route', () => paintCons({ fromTarget: document.activeElement === target }));
  paintCons();

  // ---- Plan payları
  const margin = (id, outId, key, storeKey, apply) => {
    const el = $(id);
    el.value = getState('route')[key];
    $(outId).textContent = `%${el.value}`;
    el.addEventListener('input', () => {
      const v = Number(el.value);
      $(outId).textContent = `%${v}`;
      apply(v);
      save(storeKey, v);
      patch('route', { [key]: v });
    });
  };
  margin('charger-min', 'charger-min-out', 'chargerMin', 'chargerMin', (v) => { PLANNER.chargerMinArrival = v; });
  margin('max-charge', 'max-charge-out', 'maxChargeTo', 'maxChargeTo', (v) => { PLANNER.maxChargeTo = v; });
}
