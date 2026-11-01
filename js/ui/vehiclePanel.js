import { getState, patch, subscribe } from '../state.js';
import { save, remove } from '../utils/storage.js';
import { VEHICLE, VEHICLES, PHYSICS, PLANNER } from '../config.js';
import { kwhPer100 } from '../physics/model.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const FIELDS = { batteryNetKwh: 'veh-bat', massKg: 'veh-mass', cd: 'veh-cd', frontalAreaM2: 'veh-area', maxDcKw: 'veh-dc' };

/** Araç seçimi/özel değerler, tüketim düzeltmesi ve plan payları (varış/şarj hedefi). */
export function initVehiclePanel() {
  // ---- Araç: Marka › Model › Pil seçilir, "Kaydet ve uygula" ile saklanır; değişince sayfa yenilenir (modüller batarya vb. değerleri başlangıçta okur)
  const brandSel = $('veh-brand');
  const modelSel = $('veh-model');
  const packSel = $('veh-pack');
  const uniq = (arr) => [...new Set(arr)];
  const byId = (id) => VEHICLES.find((v) => v.id === id);
  const cur = byId(VEHICLE.id) || byId('custom');
  let selectedId = cur.id;

  const fill = (spec) => Object.entries(FIELDS).forEach(([k, id]) => { $(id).value = spec[k]; });
  const setOptions = (sel, items, value) => {
    sel.replaceChildren(...items.map((t) => new Option(t, t)));
    sel.value = value;
  };
  const pickPack = () => {
    const v = VEHICLES.find((x) => x.brand === brandSel.value && x.model === modelSel.value && x.pack === packSel.value);
    if (!v) return;
    selectedId = v.id;
    fill(v);
  };
  const fillPacks = (keep) => {
    const packs = VEHICLES.filter((x) => x.brand === brandSel.value && x.model === modelSel.value).map((x) => x.pack);
    setOptions(packSel, packs, keep && packs.includes(keep) ? keep : packs[0]);
    pickPack();
  };
  const fillModels = (keep) => {
    const models = uniq(VEHICLES.filter((x) => x.brand === brandSel.value).map((x) => x.model));
    setOptions(modelSel, models, keep && models.includes(keep) ? keep : models[0]);
    fillPacks();
  };
  setOptions(brandSel, uniq(VEHICLES.map((x) => x.brand)), cur.brand);
  setOptions(modelSel, uniq(VEHICLES.filter((x) => x.brand === cur.brand).map((x) => x.model)), cur.model);
  setOptions(packSel, VEHICLES.filter((x) => x.brand === cur.brand && x.model === cur.model).map((x) => x.pack), cur.pack);
  fill(VEHICLE); // kayıtlı (düzenlenmiş olabilir) değerler
  brandSel.addEventListener('change', () => fillModels());
  modelSel.addEventListener('change', () => fillPacks());
  packSel.addEventListener('change', pickPack);

  const paintSaved = () => {
    const name = VEHICLE.name || cur.name;
    $('veh-saved').textContent = `Kayıtlı araç: ${name}`;
    const el = $('veh-name');
    if (el) el.textContent = cur.id === 'custom' ? 'Özel araç' : `${cur.brand} ${cur.model}`;
  };
  paintSaved();

  // Bir değeri elle değiştirmek hazır aracı "Özel araç" yapar (alanlardaki değerlere dokunulmaz)
  const custom = byId('custom');
  Object.values(FIELDS).forEach((id) => $(id).addEventListener('input', () => {
    if (selectedId === 'custom') return;
    selectedId = 'custom';
    setOptions(brandSel, uniq(VEHICLES.map((x) => x.brand)), custom.brand);
    setOptions(modelSel, [custom.model], custom.model);
    setOptions(packSel, [custom.pack], custom.pack);
  }));

  $('veh-apply').addEventListener('click', () => {
    const base = byId(selectedId);
    const spec = { name: selectedId === 'custom' ? `Özel araç (${$('veh-bat').value} kWh)` : base.name };
    for (const [k, id] of Object.entries(FIELDS)) {
      const n = Number($(id).value);
      if (!(n > 0)) return toast('Araç değerleri geçersiz');
      spec[k] = n;
    }
    const busy = getState('system').ocr || getState('plan').status === 'ready';
    if (busy && !confirm('Araç değişince sayfa yenilenir; aktif plan ve OCR sıfırlanır. Devam edilsin mi?')) return;
    save('vehicle', { id: selectedId, spec });
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
    const fmt = (v) => (key === 'tolerance' ? `±${v}` : `%${v}`);
    $(outId).textContent = fmt(el.value);
    el.addEventListener('input', () => {
      const v = Number(el.value);
      $(outId).textContent = fmt(v);
      apply(v);
      save(storeKey, v);
      patch('route', { [key]: v });
    });
  };
  margin('charger-min', 'charger-min-out', 'chargerMin', 'chargerMin', (v) => { PLANNER.chargerMinArrival = v; });
  margin('max-charge', 'max-charge-out', 'maxChargeTo', 'maxChargeTo', (v) => { PLANNER.maxChargeTo = v; });
  const slow = $('allow-slow');
  slow.checked = PLANNER.allowSlow;
  slow.addEventListener('change', () => {
    PLANNER.allowSlow = slow.checked;
    save('allowSlow', slow.checked);
    patch('route', { allowSlow: slow.checked }); // planı yeniden hesaplat
  });
  margin('min-add', 'min-add-out', 'minStopAdd', 'minStopAdd', (v) => { PLANNER.minStopAdd = v; });
  margin('tolerance', 'tolerance-out', 'tolerance', 'tolerance', (v) => { PLANNER.tolerance = v; });
}
