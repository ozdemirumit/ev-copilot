// Daha Fazla > Hesap kartı: davetle Google girişi, senkron durumu, çıkış ve hesabı silme. Telefona hiçbir anahtar yazılmaz.
import { currentUser, deleteAccount, isSignedIn, pendingInvite, prepareGoogleSignIn, setPendingInvite, signOut } from '../account/auth.js';
import { syncNow, syncState } from '../account/sync.js';
import { toast } from './toast.js';
import { sharingOn, setSharing } from '../account/community.js';
import { getPlan, refreshCaps } from '../net/proxy.js';
import { locale, tr, t } from '../i18n/index.js';

const $ = (id) => document.getElementById(id);
const ERRORS = {
  invite_required: 'Davet gerekli', invite_invalid: 'Davet geçersiz', invite_used: 'Davet kullanılmış', invite_expired: 'Davetin süresi dolmuş',
  invite_revoked: 'Davet iptal edilmiş', disabled: 'Hesap kapalı', code: 'Kod yanlış girildi: girişi yeniden başlat', timeout: 'Giriş zaman aşımına uğradı',
};

export function initAccountPanel() {
  const out = $('acc-out');
  const link = $('acc-link');
  const invite = $('acc-invite');
  let waiting = false;

  function paint() {
    const user = currentUser();
    const signed = isSignedIn();
    $('acc-in').classList.toggle('hidden', signed);
    $('acc-sync').classList.toggle('hidden', !signed);
    if (!signed) {
      if (!invite.value) invite.value = pendingInvite();
      return;
    }
    const pl = getPlan();
    const box = $('acc-plan');
    const part = (t) => Object.assign(document.createElement('span'), { textContent: t });
    box.replaceChildren(part('Plan:'), ' ', part(pl?.premium ? 'Premium' : 'Ücretsiz'),
      ...(pl?.premium && pl.until && !user?.admin ? [' · ', part(tr('{0} tarihine kadar').replace('{0}', new Date(pl.until).toLocaleDateString(locale())))] : []));
    $('acc-name').textContent = user?.name || '';
    $('acc-email').textContent = user?.email || '';
    $('acc-sync-line').textContent = syncState.busy ? tr('Eşitleniyor…')
      : syncState.error ? tr('Eşitleme hatası') + ': ' + syncState.error
        : syncState.at ? tr('Son eşitleme:') + ' ' + new Date(syncState.at).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : tr('Henüz eşitlenmedi');
  }
  $('acc-share').checked = sharingOn();
  $('acc-share').addEventListener('change', () => setSharing($('acc-share').checked));
  document.addEventListener('account-changed', paint);
  document.addEventListener('sync-changed', paint);
  document.addEventListener('plan-changed', paint);
  // Premium (ve yönetici) hesapta uygulama adı kırmızı; plan açılışta yerel kayıttan, sonra sunucudan gelir
  const paintBrand = () => $('brand').classList.toggle('premium', !!getPlan()?.premium);
  document.addEventListener('plan-changed', paintBrand);
  document.addEventListener('account-changed', paintBrand);
  paintBrand();

  // Giriş iki adımlı: önce 4 haneli kod ekranda görünür, kullanıcı "Tarayıcıda devam et"e basınca tarayıcı açılır (uygulama arka plana gidince kod görünmez olurdu)
  let prep = null;
  const pinBox = $('acc-pin-box');
  const showPin = (on) => { pinBox.classList.toggle('hidden', !on); $('acc-google').classList.toggle('hidden', on); };
  $('acc-google').addEventListener('click', () => {
    if (waiting) return;
    const code = invite.value.trim();
    if (code && !setPendingInvite(code)) return toast('Davet kodu geçersiz');
    prep = prepareGoogleSignIn(code);
    $('acc-pin').textContent = prep.code;
    out.textContent = '';
    showPin(true);
  });
  $('acc-pin-cancel').addEventListener('click', () => { prep = null; showPin(false); });
  $('acc-continue').addEventListener('click', () => {
    if (waiting || !prep) return;
    const { url, code: pin } = prep;
    const done = prep.start(); // tarayıcı sekmesi bu tıklamada açılır
    waiting = true;
    $('acc-continue').disabled = true;
    out.textContent = tr('Tarayıcıda Google ile giriş yap, sonra buraya dön…') + ' ' + t('Tarayıcı kodu sorunca şunu gir: {0}', pin);
    link.href = url;
    link.classList.remove('hidden');
    done.then(() => { toast('Giriş yapıldı'); out.textContent = ''; })
      .catch((err) => { out.textContent = '⚠️ ' + tr(ERRORS[err.code] || 'Giriş tamamlanamadı'); })
      .finally(() => { waiting = false; prep = null; $('acc-continue').disabled = false; showPin(false); link.classList.add('hidden'); paint(); });
  });

  $('acc-sync-now').addEventListener('click', () => { syncNow(); refreshCaps(); });
  $('acc-signout').addEventListener('click', async () => { await signOut(); toast('Çıkış yapıldı'); });
  $('acc-delete').addEventListener('click', async () => {
    if (!confirm('Hesabın ve sunucudaki tüm verilerin (ayarlar, yolculuk ve şarj geçmişi) silinecek. Bu geri alınamaz. Devam edilsin mi?')) return;
    toast((await deleteAccount()) ? 'Hesap silindi' : 'Hesap silinemedi');
  });

  paint();
}
