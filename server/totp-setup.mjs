// Yönetim ekranı ikinci adımı (TOTP, Microsoft Authenticator uyumlu) kurulumu. Bunu SEN kendi terminalinde çalıştırırsın:
//   node server/totp-setup.mjs            → yeni anahtar üretir, server/.env içine ADMIN_TOTP_SECRET=... yazar, anahtarı BİR KEZ ekrana yazar
//   node server/totp-setup.mjs --force    → mevcut anahtarın yerine yenisini yazar (eski Authenticator kaydı çalışmaz olur)
//   --env <dosya>                         → başka bir env dosyası (denemeler için)
// Diğer satırlara (erişim kodları, anahtarlar) dokunulmaz ve hiçbiri ekrana yazılmaz. Değiştirmeden önce dosyanın yedeği <dosya>.totp-yedek olarak
// alınır (Windows'ta yalnızca SYSTEM, Yöneticiler ve sen okuyabilirsin). Sonra sunucuyu yeniden başlat: node server/restart.mjs
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base32Encode, parseSecret } from './totp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const die = (msg) => { console.error(msg); process.exit(1); };
const USAGE = 'Kullanım: node server/totp-setup.mjs [--force] [--env <dosya>]';

let envFile = join(here, '.env');
let force = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--force') force = true;
  else if (args[i] === '--env') {
    const v = args[++i];
    if (!v || v.startsWith('--')) die('--env bir dosya yolu ister.\n' + USAGE);
    envFile = resolve(v);
  } else die('Bilinmeyen seçenek: ' + args[i] + '\n' + USAGE);
}
if (!existsSync(envFile)) die(`${envFile} yok: önce server/.env.example dosyasını server/.env olarak kopyalayıp doldur.`);

const orig = readFileSync(envFile, 'utf8');
const eol = orig.includes('\r\n') ? '\r\n' : '\n';
// Etkin (yorum olmayan) ADMIN_TOTP_SECRET satırları; satır sonu ayrı yakalanır ki diğer satırlar bayt bayt aynı kalsın.
const RE = /^(﻿?)[ \t]*ADMIN_TOTP_SECRET[ \t]*=([^\r\n]*)(\r?\n|$)/gm;
const found = [...orig.matchAll(RE)];
const current = found.map((m) => m[2].trim().replace(/^(["'])(.*)\1$/, '$2')).find(Boolean);
if (current && !force) {
  die(`${envFile} içinde zaten bir ADMIN_TOTP_SECRET var (değeri gösterilmez).\n`
    + 'Yeni anahtar üretmek için --force ekle: telefondaki eski Authenticator kaydı çalışmaz olur, yenisini eklemen gerekir.');
}

const secret = base32Encode(randomBytes(20)); // 160 bit (RFC 4226 önerisi)
if (parseSecret(secret)?.length !== 20) die('İç hata: üretilen anahtar doğrulanamadı; hiçbir şey değiştirilmedi.');
const line = `ADMIN_TOTP_SECRET=${secret}`;
let out;
if (found.length) {
  let first = true;
  out = orig.replace(RE, (_, bom, _v, end) => { if (first) { first = false; return bom + line + end; } return bom; }); // ilki yerinde değişir, fazlası silinir
} else {
  out = orig + (orig && !orig.endsWith('\n') ? eol : '')
    + '# Yönetim ekranı ikinci adımı (TOTP, Microsoft Authenticator): node server/totp-setup.mjs ile üretildi. Kapatmak için bu satırı sil ve sunucuyu yeniden başlat.' + eol
    + line + eol;
}

// Yedek: önce boş dosya, izinleri kısıtlanır, sonra içerik yazılır (erişim kodları geniş izinli bir dosyada kalmasın)
const bak = envFile + '.totp-yedek';
try {
  writeFileSync(bak, '', { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(bak, 0o600); // dosya önceden varsa mode yok sayılır
  else {
    const me = `${process.env.USERDOMAIN || '.'}\\${process.env.USERNAME}`;
    execFileSync('icacls', [bak, '/inheritance:r', '/grant:r', '*S-1-5-18:F', '*S-1-5-32-544:F', `${me}:F`], { stdio: 'ignore' });
  }
  writeFileSync(bak, orig);
} catch {
  try { unlinkSync(bak); } catch { /* yok */ }
  die('Yedek dosyası güvenli izinlerle oluşturulamadı; hiçbir şey değiştirilmedi.');
}

// Yerinde yazılır (dosyanın kısıtlı Windows izinleri korunur), sonra okunup doğrulanır; tutmazsa eski içerik geri yazılır.
writeFileSync(envFile, out);
const check = readFileSync(envFile, 'utf8');
const after = [...check.matchAll(RE)];
if (check !== out || after.length !== 1 || after[0][2].trim() !== secret) {
  writeFileSync(envFile, orig);
  die('Yazılan dosya doğrulanamadı; eski içerik geri yüklendi.');
}

const groups = secret.match(/.{1,4}/g).join(' ');
const uri = `otpauth://totp/EV%20Route%20Finder%20Y%C3%B6netim?secret=${secret}&issuer=EV%20Route%20Finder&algorithm=SHA1&digits=6&period=30`;
console.log([
  '',
  `Yönetim ekranı ikinci adım (TOTP) anahtarı üretildi ve ${envFile} dosyasına yazıldı.`,
  'Anahtar YALNIZCA ŞİMDİ gösterilir. Fotoğrafını çekme, kimseye gönderme, bir yere yapıştırma.',
  '',
  "Microsoft Authenticator'a ekle:",
  "  1) Uygulamada + (Hesap ekle) > 'Diğer hesap (Google, Facebook vb.)'",
  "  2) QR kodu tara ekranında 'Kodu el ile gir' seçeneğine dokun (bu betik QR çizmez)",
  '  3) Hesap adı:     EV Route Finder Yönetim',
  `     Gizli anahtar: ${groups}`,
  '     (boşluklu ya da boşluksuz yazılabilir; harfler büyük ya da küçük olabilir)',
  "  4) Son'a dokun. Uygulama her 30 saniyede bir 6 haneli kod gösterir.",
  '',
  'Başka bir doğrulayıcı uygulama otpauth adresi isterse (QR üretmek için bir web sitesine YAPIŞTIRMA, anahtar sızar):',
  `  ${uri}`,
  '',
  'Şimdi sunucuyu yeniden başlat:  node server/restart.mjs',
  "Sonra /yonetim sayfasında erişim kodunun yanında 'Doğrulama kodu (6 hane)' istenir. Bu bilgisayardaki komut satırı",
  'betikleri (premium.mjs, restart.mjs, invite.mjs) değişmeden çalışır.',
  '',
  'Telefonu kaybedersen ya da kapatmak istersen: server/.env içindeki ADMIN_TOTP_SECRET satırını sil ve sunucuyu yeniden',
  'başlat (node server/restart.mjs). Yeni telefon için: node server/totp-setup.mjs --force',
  `Yedek: ${bak} (değişiklikten önceki içerik; girişi denedikten sonra silebilirsin).`,
  '',
].join('\n'));
