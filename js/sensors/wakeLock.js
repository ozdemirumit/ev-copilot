import { getState, patch } from '../state.js';
import { toast } from '../ui/toast.js';
import { load, save } from '../utils/storage.js';

let sentinel = null;

async function acquire() {
  sentinel = await navigator.wakeLock.request('screen');
  sentinel.addEventListener('release', () => { sentinel = null; });
}

export function initWakeLock() {
  const btn = document.getElementById('btn-wake');
  const sw = document.getElementById('wake-switch');
  if (!('wakeLock' in navigator)) {
    btn.disabled = true;
    btn.title = 'Wake Lock bu tarayıcıda desteklenmiyor';
    if (sw) { sw.disabled = true; sw.checked = false; }
    return;
  }

  const paint = () => {
    const on = getState('system').wakeLock;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    if (sw) sw.checked = on;
  };

  // Simge düğmesi ve Açık/Kapalı anahtarı aynı işi yapar; ikisi de durumla eşitlenir.
  const toggle = async () => {
    try {
      if (getState('system').wakeLock) {
        patch('system', { wakeLock: false });
        save('wakeOn', false);
        await sentinel?.release();
      } else {
        await acquire();
        patch('system', { wakeLock: true });
        save('wakeOn', true);
        toast('Ekran açık kalacak');
      }
    } catch (err) {
      toast('Wake Lock alınamadı: ' + err.message);
    }
    paint();
  };
  btn.addEventListener('click', toggle);
  sw?.addEventListener('change', toggle);

  // Önceki oturumda açıksa uygulama açılınca yeniden almayı dene (kullanıcı dokunuşu gerekmez; olmazsa sessizce vazgeç).
  if (load('wakeOn', false)) {
    acquire().then(() => { patch('system', { wakeLock: true }); paint(); }).catch(() => {});
  }

  // Sekme gizlenince kilit sistem tarafından bırakılır; geri gelince yeniden al.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && getState('system').wakeLock && !sentinel) {
      try { await acquire(); } catch { patch('system', { wakeLock: false }); paint(); }
    }
  });
}
