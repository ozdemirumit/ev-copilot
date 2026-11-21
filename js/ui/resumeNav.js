// "Yarım kalan navigasyonu sürdür" arayüzü (v0.99.121): aktif plan bu cihazda saklanır (js/nav/resumePlan.js); uygulama sürüş ortasında kapanıp
// yeniden açılırsa üstte bir kart çıkar. "Sürdür" kayıtlı rotayla AĞSIZ navigasyonu başlatır (kendiliğinden başlamaz). Navigasyon bitince (durdurma/varış)
// kayıt silinir. Kayıt yalnız bu cihazdadır: sunucuya eşitlenmez (silent kayıt), kullanıcı "Sil" ile de kaldırabilir.
import { getState, subscribe } from '../state.js';
import { load, save, remove } from '../utils/storage.js';
import { buildSnapshot, checkSnapshot, restoreParts, ageMinutes } from '../nav/resumePlan.js';
import { adoptSavedPlan } from '../routing/controller.js';
import { startNav } from '../nav/navigator.js';
import { toast } from './toast.js';
import { t } from '../i18n/index.js';

const KEY = 'resumeNav';
const SAVE_DELAY_MS = 3000;

export function initResumeNav() {
  const $ = (id) => document.getElementById(id);
  const card = $('resume-card');
  if (!card) return;
  const version = () => String(globalThis.APP_VERSION || '');
  let timer = null;
  let wasActive = false;

  const clearSaved = () => { clearTimeout(timer); remove(KEY); paint(); };

  function paint() {
    const snap = load(KEY, null);
    const chk = snap ? checkSnapshot(snap, { version: version(), now: Date.now() }) : null;
    if (snap && !chk.ok) { remove(KEY); } // eski / farklı sürüm / bozuk kayıt sessizce silinir
    const show = !!snap && chk.ok && !getState('nav').active && getState('plan').status !== 'loading';
    card.classList.toggle('hidden', !show);
    if (show) $('resume-text').textContent = t('Yarım kalan navigasyon: {0} ({1} dk önce kaydedildi)', snap.label || t('hedef'), ageMinutes(snap, Date.now()));
  }

  function persist() {
    clearTimeout(timer);
    if (!getState('nav').active) return;
    const snap = buildSnapshot({ plan: getState('plan'), route: getState('route'), version: version(), now: Date.now() });
    if (snap) save(KEY, snap, { silent: true }); // silent: sunucu eşitlemesine (konum içerir) girmez
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(persist, SAVE_DELAY_MS); };

  subscribe('nav', (n) => {
    if (n.active) schedule();
    else if (wasActive) remove(KEY); // navigasyon bitti: kayıt silinir
    wasActive = !!n.active;
    paint();
  });
  subscribe('plan', () => { if (getState('nav').active) schedule(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); }); // telefon uygulamayı kapatmadan önceki son plan
  window.addEventListener('pagehide', persist);

  $('resume-drop').addEventListener('click', clearSaved);
  $('resume-go').addEventListener('click', async () => {
    const snap = load(KEY, null);
    const chk = snap ? checkSnapshot(snap, { version: version(), now: Date.now() }) : { ok: false };
    if (!chk.ok) { toast(t('Kayıtlı rota artık geçerli değil')); clearSaved(); return; }
    const parts = restoreParts(snap);
    adoptSavedPlan(parts.route, parts.plan);
    card.classList.add('hidden');
    await startNav();
  });

  paint();
}
