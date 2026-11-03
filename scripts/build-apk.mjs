// Android APK'sını derler ve sunucunun internetten kurulum sayfasına (https://<sunucu>/app) koyar. Kullanım: npm run apk
// Adımlar: web dosyalarını android/ içine eşitle → Gradle ile debug APK → server/public/ev-copilot.apk + app.json.
// Gerekenler: Android Studio (SDK ve JDK 21; ~/.jdks altındaki JBR bulunur). Gizli anahtar içermez.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findJdk, run } from './android-jdk.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const android = join(root, 'android');

const jdk = findJdk();
if (!jdk) { console.error('JDK 21 bulunamadı: Android Studio > Settings > Gradle JDK bölümünden indir ya da JAVA_HOME ayarla.'); process.exit(1); }
const env = { ...process.env, JAVA_HOME: jdk };
console.log(`JDK: ${jdk}`);

run(process.execPath, [join(root, 'scripts', 'copy-www.mjs')], root);
run(process.execPath, [join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], root);
run('cmd.exe', ['/c', join(android, 'gradlew.bat'), 'assembleDebug', '--console=plain'], android, env);

const apk = join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!existsSync(apk)) { console.error('APK bulunamadı: ' + apk); process.exit(1); }
const version = /APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(root, 'version.js'), 'utf8'))?.[1] || '?';
const out = join(root, 'server', 'public');
mkdirSync(out, { recursive: true });
copyFileSync(apk, join(out, 'ev-copilot.apk'));
const sha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
writeFileSync(join(out, 'app.json'), JSON.stringify({ version, builtAt: new Date().toISOString(), sha256 }, null, 1));
console.log(`\nHazır: v${version}, ${(statSync(apk).size / 1048576).toFixed(1)} MB → server/public/ev-copilot.apk\nİnternetten: <PUBLIC_URL>/app (sunucu çalışıyorsa hemen indirilebilir)`);
