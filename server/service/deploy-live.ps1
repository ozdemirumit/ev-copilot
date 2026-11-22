# Canli sunucu klasorunu (varsayilan: bu betigin deposu, ornegin MBRP-live) yeni commit'e alir ve sunucuyu yeniden baslatir; sorun cikarsa eski commit'e doner.
# Yonetici GEREKMEZ (yeniden baslatma: node server\restart.mjs, hizmeti NSSM 5 sn icinde yeni kodla acar). Dosya bilerek ASCII.
#   powershell -ExecutionPolicy Bypass -File server\service\deploy-live.ps1 -DryRun     # hicbir sey degistirmez, ne yapilacagini yazar
#   powershell -ExecutionPolicy Bypass -File server\service\deploy-live.ps1             # origin/main'e al + yeniden baslat + yokla
# Guvenlik: klasorde kirli (commitlenmemis) dosya varsa durur; eski kullanici zamanlanmis gorevi EVCoPilotProxy etkinse durur
# (sunucu yeniden baslarken portu ESKI kodla calabilir; Disable-ScheduledTask -TaskName EVCoPilotProxy, yonetici). Veri klasorune dokunmaz.
param(
  [string]$Repo,
  [string]$Ref = 'origin/main',
  [string]$Base = 'http://127.0.0.1:8787',
  [int]$WaitSec = 45,
  [switch]$DryRun,
  [switch]$IgnoreLegacyTask
)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
function Say([string]$m) { Write-Host $m }
function Fail([string]$m) { Write-Host "HATA: $m" -ForegroundColor Red; exit 1 }
function GitOut { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $o = & git -C $Repo @args 2>&1 } finally { $ErrorActionPreference = $old }; if ($LASTEXITCODE -ne 0) { throw ("git " + ($args -join ' ') + " basarisiz: " + ($o | Out-String)) }; return ($o | Out-String).Trim() }
function Http([string]$path, [string]$method = 'GET') { return (& curl.exe -s -o NUL -m 8 -w '%{http_code}' -X $method "$Base$path") }
function Wait-Up {
  for ($i = 0; $i -lt $WaitSec; $i++) {
    Start-Sleep -Seconds 1
    $r = & curl.exe -s -m 5 "$Base/v1/config" 2>$null
    if ($r -match 'providers') { return $true }
  }
  return $false
}
function Probe-Ok { $c = Http '/v1/providers'; return ($c -in '200', '401', '403') }   # 404/5xx = yeni kod calismiyor
function Restart-Proxy {
  Push-Location $Repo
  try { & node server\restart.mjs; if ($LASTEXITCODE -ne 0) { throw 'restart.mjs basarisiz' } } finally { Pop-Location }
}

if (-not (Test-Path (Join-Path $Repo 'server\proxy.mjs'))) { Fail "server\proxy.mjs bulunamadi: $Repo" }
if (-not (Test-Path (Join-Path $Repo 'server\.env'))) { Fail "server\.env yok: $Repo" }

# 1) Eski kullanici zamanlanmis gorevi (port calma tuzagi)
$t = Get-ScheduledTask -TaskName EVCoPilotProxy -ErrorAction SilentlyContinue
if ($t -and $t.State -ne 'Disabled' -and -not $IgnoreLegacyTask) {
  Fail 'Eski zamanlanmis gorev EVCoPilotProxy etkin: yeniden baslatmada portu eski kodla calabilir. Yonetici PowerShell: Disable-ScheduledTask -TaskName EVCoPilotProxy (ya da -IgnoreLegacyTask)'
}
# 2) Hizmet bu klasorden mi calisiyor?
try {
  $dir = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\EVCoPilotProxy\Parameters' -ErrorAction Stop).AppDirectory
  if ($dir -and ($dir.TrimEnd('\') -ne (Join-Path $Repo 'server').TrimEnd('\'))) { Fail "Hizmet baska klasorden calisiyor ($dir); -Repo ile dogru klasoru ver." }
} catch { Say 'Uyari: hizmet klasoru okunamadi (denetim atlandi).' }
# 3) Klasor temiz mi?
if (GitOut status --porcelain) { Fail 'Canli klasorde commitlenmemis degisiklik var; once temizle.' }

GitOut fetch origin | Out-Null
$prev = GitOut rev-parse HEAD
$target = GitOut rev-parse $Ref
Say ("Simdiki : " + $prev.Substring(0, 7))
Say ("Hedef   : " + $target.Substring(0, 7) + " ($Ref)")
if ($prev -eq $target) { Say 'Zaten guncel: yapilacak bir sey yok.'; exit 0 }
Say (((GitOut diff --stat "$prev..$target") -split "`n") | Select-Object -Last 1)
$serverChanged = [bool](GitOut diff --name-only "$prev..$target" -- server)
Say ("Sunucu kodu degisti mi: " + $(if ($serverChanged) { 'evet (yeniden baslatilacak)' } else { 'hayir (yalniz istemci; yeniden baslatma gerekmez, yine de yoklanir)' }))
if ($DryRun) { Say '*** KURU CALISTIRMA: hicbir sey degistirilmedi ***'; exit 0 }

# 4) Gec ve yeniden baslat
GitOut checkout --detach $target | Out-Null
Say 'Klasor yeni commit''e alindi.'
& node --check (Join-Path $Repo 'server\proxy.mjs')
if ($LASTEXITCODE -ne 0) { GitOut checkout --detach $prev | Out-Null; Fail 'proxy.mjs soz dizimi gecersiz: eski commit''e donuldu, yeniden baslatilmadi.' }
$ok = $true
if ($serverChanged) {
  Restart-Proxy
  $ok = (Wait-Up) -and (Probe-Ok)
} else { $ok = (Probe-Ok) }
if ($ok) { Say 'Tamam: sunucu yeni kodla yanit veriyor.'; exit 0 }

# 5) Geri al
Write-Host 'SORUN: yeni kod yanit vermedi, eski commit''e donuluyor.' -ForegroundColor Yellow
GitOut checkout --detach $prev | Out-Null
Restart-Proxy
if ((Wait-Up) -and (Probe-Ok)) { Write-Host 'Geri alindi: sunucu eski kodla yanit veriyor.' -ForegroundColor Yellow } else { Write-Host 'UYARI: geri almadan sonra da yanit yok; server\service\status.ps1 ile durumu kontrol et.' -ForegroundColor Red }
exit 2
