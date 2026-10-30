import { DEFAULT_OPERATORS } from '../config.js';
import { load, save, remove } from '../utils/storage.js';

// Kayıtlı tabloyu varsayılanlarla birleştir: sonradan eklenen operatörler eski kayıtta eksik kalmasın.
function merge(saved) {
  const base = structuredClone(DEFAULT_OPERATORS);
  if (!Array.isArray(saved)) return base;
  return base.map((d) => {
    const s = saved.find((x) => x.id === d.id);
    return s ? { ...d, price: s.price, kw: s.kw } : d;
  });
}

let operators = merge(load('operators', null));

export const getOperators = () => operators;
export const operatorById = (id) => operators.find((o) => o.id === id) || operators.at(-1);

export function persistOperators() {
  save('operators', operators.map(({ id, price, kw }) => ({ id, price, kw })));
}

export function resetOperators() {
  operators = structuredClone(DEFAULT_OPERATORS);
  remove('operators');
}

/** İstasyon etiketlerinden (name/operator/brand) operatör kimliği bul. */
export function classify(...names) {
  const text = names.filter(Boolean).join(' ').toLowerCase();
  const hit = operators.find((o) => o.match.some((m) => text.includes(m)));
  return hit ? hit.id : 'other';
}
