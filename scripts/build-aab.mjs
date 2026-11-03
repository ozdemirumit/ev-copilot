// Google Play için imzalı AAB üretir. Kullanım: npm run aab
// Adımlar: web dosyalarını eşitle → Gradle bundleRelease (imza android/keystore.properties'ten) → imzayı doğrula.
// Gerekenler: build-apk.mjs ile aynı (Android Studio, JDK 21) + android/keystore.properties (depoya girmez, docs/android.md).
// Sürüm kodu version.js'ten türetilir: x.y.z → x*1000000 + y*1000 + z (0.82.3 → 82003); Play her yüklemede artmasını ister.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findJdk, run } from './android-jdk.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const android = join(root, 'android');

const fail = (m) => { console.error(m); process.exit(1); };

const version = /APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'/.exec(readFileSync(join(root, 'version.js'), 'utf8'));
if (!version) fail('version.js içinde APP_VERSION (x.y.z) okunamadı.');
const [, major, minor, patch] = version.map(Number);
if (minor > 999 || patch > 999) fail('Sürüm kodu x*1000000 + y*1000 + z biçimi y ve z için 999 üstünü taşımaz.');
const versionName = `${major}.${minor}.${patch}`;
const versionCode = major * 1000000 + minor * 1000 + patch;

const propsFile = join(android, 'keystore.properties');
if (!existsSync(propsFile)) fail('android/keystore.properties yok: imza anahtarı tanımlı değil. Adımlar için docs/android.md "Google Play" bölümüne bak.');
const props = Object.fromEntries(readFileSync(propsFile, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
for (const k of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) if (!props[k]) fail(`android/keystore.properties içinde "${k}" eksik.`);
if (!existsSync(props.storeFile)) fail('Anahtar dosyası bulunamadı: ' + props.storeFile);

const jdk = findJdk();
if (!jdk) fail('JDK 21 bulunamadı: Android Studio > Settings > Gradle JDK bölümünden indir ya da JAVA_HOME ayarla.');
const env = { ...process.env, JAVA_HOME: jdk };
console.log(`JDK: ${jdk} · sürüm ${versionName} (kod ${versionCode})`);

run(process.execPath, [join(root, 'scripts', 'copy-www.mjs')], root);
run(process.execPath, [join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], root);
run('cmd.exe', ['/c', join(android, 'gradlew.bat'), 'bundleRelease', `-PappVersionCode=${versionCode}`, `-PappVersionName=${versionName}`, '--console=plain'], android, env);

const aab = join(android, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
if (!existsSync(aab)) fail('AAB bulunamadı: ' + aab);
run(join(jdk, 'bin', 'jarsigner.exe'), ['-verify', aab], root, env); // "jar verified." yazmalı; imzasızsa Play reddeder
console.log(`\nHazır: v${versionName} (kod ${versionCode}), ${(statSync(aab).size / 1048576).toFixed(1)} MB\n${aab}\nPlay Console > Test ve yayın > Dahili test > Yeni sürüm oluştur ile yükle.`);
