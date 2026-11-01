import { locale } from '../i18n/index.js';
import { getState, patch, subscribe, effective } from '../state.js';
import { load, save, remove } from '../utils/storage.js';
import { buildPacket, sendNow, getIntervalMs } from '../abrp/telemetry.js';
import { ABRP } from '../config.js';

const STATUS_CLASS = { idle: '', wait: 'wait', ok: 'ok', err: 'err' };

export function initAbrpPanel() {
  const els = {
    token: document.getElementById('abrp-token'),
    apikey: document.getElementById('abrp-apikey'),
    webhook: document.getElementById('abrp-webhook'),
    enabled: document.getElementById('abrp-enabled'),
    badge: document.getElementById('abrp-badge'),
    topBadge: document.getElementById('bd-abrp'),
    packet: document.getElementById('abrp-packet'),
    last: document.getElementById('abrp-last'),
    http: document.getElementById('abrp-http'),
  };
  const fields = ['token', 'apikey', 'webhook'];

  const saved = load('abrp', {});
  fields.forEach((f) => { els[f].value = saved[f] || ''; });
  patch('abrp', { enabled: !!saved.enabled });
  els.enabled.checked = getState('abrp').enabled;
  syncStatus();

  function persist() {
    save('abrp', {
      token: els.token.value.trim(),
      apikey: els.apikey.value.trim(),
      webhook: els.webhook.value.trim(),
      enabled: getState('abrp').enabled,
    });
  }

  fields.forEach((f) => els[f].addEventListener('change', persist));

  // Gönderim aralığı: büyük aralık = daha az veri. Tahmini veri kullanımı seçimle birlikte gösterilir.
  const sel = document.getElementById('abrp-interval');
  ABRP.intervalOptionsS.forEach((s) => {
    const o = document.createElement('option');
    o.value = String(s);
    o.textContent = `${s} sn${s === ABRP.intervalMs / 1000 ? ' (önerilen)' : ''}`;
    sel.append(o);
  });
  sel.value = String(getIntervalMs() / 1000);
  const paintRate = () => {
    const s = Number(sel.value);
    const mbPerHour = (ABRP.bytesPerPacket * 3600) / s / 1048576;
    document.getElementById('abrp-rate').textContent = `≈ ${mbPerHour.toFixed(2)} MB/saat sürüşte; araç duruyorken en az ${ABRP.parkedIntervalMs / 1000} sn'de bir gönderilir.`;
  };
  sel.addEventListener('change', () => { save('abrpInterval', Number(sel.value)); paintRate(); });
  paintRate();

  els.enabled.addEventListener('change', () => {
    const on = els.enabled.checked;
    patch('abrp', on
      ? { enabled: true, status: 'wait', text: 'Beklemede' }
      : { enabled: false, status: 'idle', text: 'Pasif' });
    persist();
    if (on) sendNow();
  });

  let revealed = false;
  document.getElementById('abrp-reveal').addEventListener('click', (ev) => {
    revealed = !revealed;
    els.token.type = els.apikey.type = revealed ? 'text' : 'password';
    ev.currentTarget.textContent = revealed ? '🙈 Gizle' : '👁️ Göster';
  });

  document.getElementById('abrp-clear').addEventListener('click', () => {
    fields.forEach((f) => { els[f].value = ''; });
    remove('abrp');
    els.enabled.checked = false;
    patch('abrp', { enabled: false, status: 'idle', text: 'Pasif', http: null, webhook: null });
  });

  function syncStatus() {
    const a = getState('abrp');
    const cls = STATUS_CLASS[a.status];
    els.badge.className = 'badge ' + cls;
    els.badge.textContent = a.text;
    els.topBadge.className = 'badge ' + cls;
    els.topBadge.textContent = 'ABRP: ' + a.text.toLowerCase();
    els.http.textContent = a.http == null ? '—' : String(a.http);
    document.getElementById('abrp-webhook-status').textContent = a.webhook || '—';
    els.last.textContent = a.lastSentAt ? new Date(a.lastSentAt).toLocaleTimeString(locale()) : '—';
  }

  const refreshPacket = () => { els.packet.textContent = JSON.stringify(buildPacket(), null, 2); };

  subscribe('abrp', syncStatus);
  subscribe(['live', 'sim'], refreshPacket);
  refreshPacket();
}
