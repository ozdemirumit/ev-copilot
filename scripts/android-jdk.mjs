// build-apk.mjs ve build-aab.mjs için ortak yardımcılar: JDK bulma ve komut çalıştırma. Gizli anahtar içermez.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function findJdk() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java.exe'))) return process.env.JAVA_HOME;
  const dirs = [join(homedir(), '.jdks'), 'C:\\Program Files\\Android\\Android Studio'];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const cands = d.endsWith('.jdks') ? readdirSync(d).filter((n) => /^(jbr|jdk|temurin|corretto)-?(17|21)/.test(n)).map((n) => join(d, n)) : [join(d, 'jbr')];
    for (const c of cands) if (existsSync(join(c, 'bin', 'java.exe'))) return c; // Gradle 8.14 için JDK 17/21; Android Studio'nun JBR'ı 25 olabilir
  }
  return null;
}

export function run(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\nHata: ${cmd} ${args.join(' ')} (kod ${r.status})`); process.exit(1); }
}
