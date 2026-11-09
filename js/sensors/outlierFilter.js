/**
 * Fiziksel makullük filtresi — pil yüzdesi ve ekran hızı için (DOM'suz, saf; node ile test edilir).
 *
 * Girdi, bir OCR çevriminin çok kareli ortak kararıdır (ocrConsensus.js). Kurallar:
 *  - İlk okuma tek çevrimle kabul edilmez; ardışık tutarlı çevrim ister. Elde bir ipucu varsa (kayıtlı/elle değer) ondan uzak ya da
 *    rakam karışıklığı gibi görünen ilk okuma daha çok çevrim ister (ilk okumada 73→13).
 *  - Son doğrulanmış değerden izin verilen sapma süreyle büyür ama HER ZAMAN üst sınırlıdır.
 *  - Pil yönü bağlama bağlıdır: sürüşte yükseliş yalnızca rejenerasyon kadar, duruşta düşüş çok küçük, şarj hızı araca göre.
 *  - Sınırı aşan değer, ardışık ve yüksek skorlu çevrimlerle yeniden eşitlenebilir (yanlış referansta kilitlenmemek için); rakam
 *    karışıklığı gibi görünen sapmalar ve sürüşte fiziksel olmayan yükselişler daha uzun kanıt ister.
 */

const CONFUSABLE = new Set(['17', '14', '38', '08', '56', '68', '89', '39', '59', '06', '09', '49', '35', '25', '27']);

/** İki okuma OCR rakam karışıklığı olabilir mi? (tek hane karışık çifti ya da düşen/eklenen hane) */
export function confusable(a, b) {
  if (a == null || b == null || a === b) return false;
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) {
    if (a === 0 || b === 0) return false;
    const [short, long] = x.length < y.length ? [x, y] : [y, x];
    return long.endsWith(short) || long.startsWith(short);
  }
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    diff++;
    if (!CONFUSABLE.has([x[i], y[i]].sort().join(''))) return false;
  }
  return diff === 1;
}

/** short tek haneli ve long iki haneli long'un bir hanesi mi? (42 → 4 veya 2: hane kaybı) */
export function isFragment(short, long) {
  return short != null && long != null && short >= 0 && short < 10 && long >= 10 && long <= 99 && String(long).includes(String(short));
}

export function createFilter({
  min = 0, max = 100,
  allowance, // (delta, dtMs, ctx) → izin verilen mutlak sapma (üst sınırlı)
  firstCycles = 2, firstFarCycles = 3, firstConfusableCycles = 5, hintFar = 15,
  resyncCycles = 6, confusableResyncCycles = 12, resyncFactor = () => 1,
  candidateTol = 1, pendingMaxAgeMs = 20000,
  minScore = 0.4, firstMinScore = 0.5, resyncMinScore = 0.6,
  fragmentGuard = false, recoverCycles = 2, recoverNoEvidenceCycles = 4, recoverMinScore = 0.5, recentMax = 8, recentMaxAgeMs = 60000,
} = {}) {
  let last = null; // { value, t }
  let pending = null; // { value, count, t }
  let recent = []; // son çevrimler { value, digits, t }: hatalı tek haneden kurtulmak için ardışık olmayan kanıt da sayılır

  const bump = (value, t) => {
    const same = pending && Math.abs(value - pending.value) <= candidateTol && t - pending.t <= pendingMaxAgeMs;
    pending = { value, t, count: same ? pending.count + 1 : 1 };
    return pending.count;
  };
  const commit = (value, t) => { last = { value, t }; pending = null; };
  const held = () => last?.value ?? null;

  function accept(value, t = Date.now(), ctx = {}) {
    const { score = 1, hint = null, digits = null } = ctx;
    if (!Number.isInteger(value) || value < min || value > max) return { ok: false, reason: 'range', value: held() };
    if (score < minScore) return { ok: false, reason: 'low-score', value: held() };

    if (!last) {
      if (score < firstMinScore) return { ok: false, reason: 'low-score', value: null };
      const count = bump(value, t);
      let need = firstCycles;
      if (hint != null) {
        if (confusable(value, Math.round(hint))) need = firstConfusableCycles;
        else if (Math.abs(value - hint) > hintFar) need = firstFarCycles;
      }
      if (count >= need) { commit(value, t); return { ok: true, reason: 'first', value }; }
      return { ok: false, reason: 'verifying', value: null, count, need };
    }

    if (score >= recoverMinScore) {
      recent = recent.filter((r) => t - r.t <= recentMaxAgeMs).slice(-(recentMax - 1));
      recent.push({ value, digits, t });
    }

    // Elde hatalı tek hane var (gerçek 42 iken 4 kabul edilmiş): araya 4/2 karışsa da iki haneli kanıt birikir, kilit kalmaz.
    if (fragmentGuard && isFragment(last.value, value)) {
      const same = recent.filter((r) => Math.abs(r.value - value) <= candidateTol);
      const proven = same.filter((r) => r.digits >= 2).length;
      if (proven >= recoverCycles || same.length >= recoverNoEvidenceCycles) { commit(value, t); return { ok: true, reason: 'recovered', value }; }
      return { ok: false, reason: 'recovering', value: last.value, count: Math.max(proven, same.length), need: proven ? recoverCycles : recoverNoEvidenceCycles };
    }

    const delta = value - last.value;
    const fragment = fragmentGuard && isFragment(value, last.value);
    // Hane kaybı şüphesi: sapma küçük olsa bile (12 → 1) görüntüde gerçekten tek rakam görülmedikçe doğrudan kabul edilmez
    if (Math.abs(delta) <= allowance(delta, t - last.t, ctx) && (!fragment || digits === 1)) { commit(value, t); return { ok: true, reason: 'ok', value }; }

    const reason = fragment ? 'fragment' : 'jump';
    if (score < resyncMinScore) return { ok: false, reason, value: last.value };
    const count = bump(value, t);
    // Gerçekten tek haneye düşmüşse (görüntüde tek rakam) yasak değil: yalnızca kanıt süresi kısalır
    const need = (confusable(value, last.value) && !(fragment && digits === 1) ? confusableResyncCycles : resyncCycles) * resyncFactor(delta, ctx);
    if (count >= need) { commit(value, t); return { ok: true, reason: 'resync', value }; }
    return { ok: false, reason, value: last.value, count, need };
  }

  /** Manuel kalibrasyon veya dış kaynak: referansı doğrudan ayarla. */
  function reset(value = null, t = Date.now()) {
    last = value == null ? null : { value, t };
    pending = null;
    recent = [];
  }

  /** Motor değişti: doğrulanmış değer kalır, birikmiş aday kanıtı silinir. */
  function clearEvidence() {
    pending = null;
    recent = [];
  }

  return { accept, reset, clearEvidence, get last() { return held(); } };
}

const WINDOW_MS = 5000; // bu süreye kadar yalnızca temel tolerans geçerli
const STOP_KMH = 5; // bu hızın altı "duruyor" (şarj olabilir)
const extraMin = (dtMs) => Math.max(0, dtMs - WINDOW_MS) / 60000;
const isMoving = (speedKmh) => (speedKmh == null ? null : speedKmh >= STOP_KMH);

/** chargePctPerMin: araca göre en yüksek şarj hızı (%/dk). Hız bilinmiyorsa iki yön de izinli (yine üst sınırlı). */
export function createSocFilter({ chargePctPerMin = 3, maxJump = 2 } = {}) {
  return createFilter({
    min: 0, max: 100,
    allowance: (delta, dtMs, { speedKmh = null } = {}) => {
      const moving = isMoving(speedKmh);
      const m = extraMin(dtMs);
      if (delta > 0) return moving === true ? Math.min(3, 1 + 0.5 * m) : Math.min(20, maxJump + chargePctPerMin * m); // rejenerasyon | şarj
      return moving === false ? Math.min(3, 1 + 0.1 * m) : Math.min(12, maxJump + 2 * m); // duruş | deşarj
    },
    resyncFactor: (delta, { speedKmh = null } = {}) => (delta > 0 && isMoving(speedKmh) === true ? 2 : 1),
    fragmentGuard: true,
  });
}

export function createSpeedFilter({ maxJump = 40 } = {}) {
  return createFilter({
    min: 0, max: 250,
    allowance: (delta, dtMs) => Math.min(maxJump * 2, maxJump + 480 * extraMin(dtMs)), // 8 km/h/sn, en çok 2 katı
    resyncCycles: 3, confusableResyncCycles: 6, candidateTol: 20,
  });
}
