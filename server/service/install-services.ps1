# EV Co-Pilot sunucusunu Windows hizmeti (service) olarak kurar: bilgisayar acilinca, oturum acilmadan baslar, cokerse kendiliginden yeniden baslar.
# YONETICI olarak calistir:  Baslat > PowerShell > Yonetici olarak calistir >
#   powershell -ExecutionPolicy Bypass -File "D:\AI-Codes\Claude Code\MBRP\server\service\install-services.ps1"
# Once denemek icin (hicbir sey degistirmez):  ... install-services.ps1 -DryRun
# Dosya bilerek ASCII: Windows PowerShell 5.1 BOM'suz UTF-8'i bozar.
#
# Kurulanlar:
#   EVCoPilotProxy  : node server\proxy.mjs  (ara sunucu: hesaplar, anahtarlar, /app)       -> 127.0.0.1:8787
#   EVCoPilotCaddy  : caddy run              (HTTPS, sertifika yenileme)                    -> :443
#   EVCoPilotBackup : gunluk 03:30 db.json yedegi (zamanlanmis gorev, SYSTEM)
#   EVCoPilotWatchdog: 5 dakikada bir saglik denetimi, yanit yoksa hizmeti yeniden baslatir (zamanlanmis gorev, SYSTEM)
# Hizmetleri NSSM sarmalar (node ve caddy hizmet protokolunu bilmez). Hizmet hesabi: NT AUTHORITY\LocalService (dusuk yetkili).
param(
  [string]$CaddyExe,
  [string]$Caddyfile,
  [string]$BaseDir = 'C:\ProgramData\EVCoPilot',
  [string]$BackupDir,
  [switch]$SkipPower,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

function Step([string]$text, [scriptblock]$sb) {
  Write-Host "-> $text"
  if (-not $DryRun) { & $sb }
}
function Fail([string]$msg) { Write-Host "HATA: $msg" -ForegroundColor Red; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $DryRun) { Fail 'Yonetici olarak calistirilmali (PowerShell > Yonetici olarak calistir).' }
if ($DryRun) { Write-Host '*** KURU CALISTIRMA: hicbir sey degistirilmiyor ***' -ForegroundColor Yellow }

$server = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $server
$logs = Join-Path $BaseDir 'logs'
$caddyDir = Join-Path $BaseDir 'caddy'
if (-not $BackupDir) { $BackupDir = Join-Path $BaseDir 'backup' }
$dataDir = Join-Path $server 'data'
$envFile = Join-Path $server '.env'

# ---- on kosullar ----
if (-not (Test-Path (Join-Path $server 'proxy.mjs'))) { Fail "proxy.mjs bulunamadi: $server" }
if (-not (Test-Path $envFile)) { Fail "server\.env yok: once .env.example'i kopyalayip doldur." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) { Fail 'node.exe bulunamadi (Node.js kurulu mu?).' }
if (-not $CaddyExe) {
  $CaddyExe = (Get-Command caddy -ErrorAction SilentlyContinue).Source
  if (-not $CaddyExe) { $CaddyExe = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter 'caddy.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
}
if (-not $CaddyExe -or -not (Test-Path $CaddyExe)) { Fail 'caddy.exe bulunamadi: -CaddyExe ile yolunu ver (winget install CaddyServer.Caddy).' }
if (-not $Caddyfile) { $Caddyfile = Join-Path $env:USERPROFILE 'caddy\Caddyfile' }
if (-not (Test-Path $Caddyfile)) { Fail "Caddyfile bulunamadi: $Caddyfile (-Caddyfile ile ver)." }

function Find-Nssm {
  $c = (Get-Command nssm -ErrorAction SilentlyContinue).Source
  if ($c) { return $c }
  Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'), 'C:\ProgramData\chocolatey\bin', 'C:\Program Files\nssm' -Filter 'nssm.exe' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'win64|chocolatey|Program Files' } | Select-Object -First 1 -ExpandProperty FullName
}
$nssm = Find-Nssm
if (-not $nssm) {
  Step 'NSSM kuruluyor (winget install NSSM.NSSM)' {
    winget install --id NSSM.NSSM -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Fail 'NSSM kurulamadi. https://nssm.cc adresinden indirip nssm.exe yolunu PATH e ekle ve betigi tekrar calistir.' }
  }
  $nssm = Find-Nssm
  if (-not $nssm -and -not $DryRun) { Fail 'nssm.exe bulunamadi.' }
}
Write-Host "node: $node"; Write-Host "caddy: $CaddyExe"; Write-Host "Caddyfile: $Caddyfile"; Write-Host "nssm: $nssm"
Write-Host "sunucu: $server"; Write-Host "veri: $BaseDir"

function Nssm { & $nssm @args | Out-Null; if ($LASTEXITCODE -ne 0) { Fail "nssm $($args -join ' ') basarisiz" } }

# ---- eski kullanici dongulerini kapat (Baslangic kisayollari, start.ps1 ve start-caddy.ps1 donguleri) ----
Step 'Eski kullanici donguleri (Baslangic kisayollari ve arka plan betikleri) kapatiliyor' {
  foreach ($n in 'EVCoPilotProxy.lnk', 'EVCoPilotCaddy.lnk') {
    $l = Join-Path ([Environment]::GetFolderPath('Startup')) $n
    if (Test-Path $l) { Remove-Item $l -Force }
  }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'server\\start\.ps1|start-caddy\.ps1' -and $_.Name -match 'powershell' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|cmd' -and $_.CommandLine -match 'proxy\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-Process caddy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# ---- klasorler ve dosyalar ----
Step "Klasorler: $BaseDir" {
  foreach ($d in $BaseDir, $logs, $caddyDir, (Join-Path $caddyDir 'data'), (Join-Path $caddyDir 'config'), $BackupDir, $dataDir) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}
Step 'Caddy ve Caddyfile hizmet klasorune kopyalaniyor' {
  Copy-Item $CaddyExe (Join-Path $caddyDir 'caddy.exe') -Force
  Copy-Item $Caddyfile (Join-Path $caddyDir 'Caddyfile') -Force
  # Mevcut sertifikalari tasi (yeniden almaya gerek kalmasin)
  $old = Join-Path $env:APPDATA 'Caddy'
  $new = Join-Path $caddyDir 'data\caddy'
  if ((Test-Path $old) -and -not (Test-Path (Join-Path $new 'certificates'))) { New-Item -ItemType Directory -Force -Path $new | Out-Null; Copy-Item (Join-Path $old '*') $new -Recurse -Force }
}
Step 'Yetkiler: hizmet hesabi (LocalService) yalniz gereken klasorlere erisir; .env yalnizca yonetici/SYSTEM/sen/LocalService' {
  $ls = '*S-1-5-19'
  icacls $server /grant "${ls}:(OI)(CI)RX" | Out-Null
  icacls $dataDir /grant "${ls}:(OI)(CI)M" | Out-Null
  icacls $BaseDir /grant "${ls}:(OI)(CI)M" | Out-Null
  icacls $envFile /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' "${ls}:R" "${env:USERDOMAIN}\${env:USERNAME}:F" | Out-Null
}

# ---- hizmetler ----
function Install-Svc([string]$name, [string]$display, [string]$desc, [string]$exe, [string]$arguments, [string]$dir, [string[]]$extraEnv, [string]$logName) {
  if (Get-Service $name -ErrorAction SilentlyContinue) { Stop-Service $name -Force -ErrorAction SilentlyContinue; & $nssm remove $name confirm | Out-Null }
  Nssm install $name $exe $arguments
  Nssm set $name AppDirectory $dir
  Nssm set $name DisplayName $display
  Nssm set $name Description $desc
  Nssm set $name Start SERVICE_AUTO_START
  Nssm set $name ObjectName 'NT AUTHORITY\LocalService'
  Nssm set $name AppExit Default Restart
  Nssm set $name AppRestartDelay 5000
  Nssm set $name AppThrottle 10000
  Nssm set $name AppStopMethodConsole 8000
  Nssm set $name AppStdout (Join-Path $logs "$logName.out.log")
  Nssm set $name AppStderr (Join-Path $logs "$logName.err.log")
  Nssm set $name AppRotateFiles 1
  Nssm set $name AppRotateOnline 1
  Nssm set $name AppRotateBytes 5242880
  if ($extraEnv) { Nssm set $name AppEnvironmentExtra @extraEnv }
  sc.exe failure $name reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null  # NSSM'in kendisi cokerse Windows yeniden baslatir
}
Step 'Hizmet: EVCoPilotProxy' {
  Install-Svc 'EVCoPilotProxy' 'EV Co-Pilot ara sunucu' 'EV Co-Pilot hesap, anahtar ve APK sunucusu (node proxy.mjs, 127.0.0.1:8787)' $node 'proxy.mjs' $server @() 'proxy'
}
Step 'Hizmet: EVCoPilotCaddy' {
  Install-Svc 'EVCoPilotCaddy' 'EV Co-Pilot HTTPS (Caddy)' 'EV Co-Pilot HTTPS ters vekili ve sertifika yenileme (Caddy, :443)' (Join-Path $caddyDir 'caddy.exe') "run --config $(Join-Path $caddyDir 'Caddyfile')" $caddyDir @("XDG_DATA_HOME=$(Join-Path $caddyDir 'data')", "XDG_CONFIG_HOME=$(Join-Path $caddyDir 'config')") 'caddy'
  sc.exe config EVCoPilotCaddy depend= Tcpip | Out-Null
}
Step 'Guvenlik duvari: gelen TCP 443 (yalniz caddy.exe)' {
  Get-NetFirewallRule -DisplayName 'EV Co-Pilot HTTPS (443)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'EV Co-Pilot HTTPS (443)' -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Program (Join-Path $caddyDir 'caddy.exe') -Profile Any | Out-Null
}

# ---- yedek ve saglik denetimi (zamanlanmis gorevler, SYSTEM) ----
function Register-Task([string]$name, [string]$script, [string]$extra, $trigger, [string]$desc) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" $extra"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $desc -Force | Out-Null
}
Step 'Gorev: EVCoPilotBackup (her gun 03:30)' {
  Register-Task 'EVCoPilotBackup' (Join-Path $PSScriptRoot 'backup.ps1') "-Dest `"$BackupDir`"" (New-ScheduledTaskTrigger -Daily -At 3:30am) 'EV Co-Pilot veri yedegi'
}
Step 'Gorev: EVCoPilotWatchdog (5 dakikada bir)' {
  $t = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-Task 'EVCoPilotWatchdog' (Join-Path $PSScriptRoot 'watchdog.ps1') "-Logs `"$logs`"" $t 'EV Co-Pilot saglik denetimi'
}

if (-not $SkipPower) {
  Step 'Guc: prizdeyken uyku ve hazirda bekletme kapali (sunucu uyumasin)' {
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change hibernate-timeout-ac 0 | Out-Null
  }
}

# ---- baslat ve dogrula ----
Step 'Hizmetler baslatiliyor' {
  Start-Service EVCoPilotProxy
  Start-Service EVCoPilotCaddy
  Start-Sleep -Seconds 6
}
Step 'Dogrulama' {
  Get-Service EVCoPilotProxy, EVCoPilotCaddy | Format-Table Name, Status, StartType -AutoSize
  $r = & curl.exe -s -m 10 http://127.0.0.1:8787/v1/config
  Write-Host "yerel /v1/config : $r"
  $r2 = & curl.exe -s -m 20 --resolve evcopilot.duckdns.org:443:127.0.0.1 https://evcopilot.duckdns.org/v1/config
  Write-Host "https /v1/config : $r2"
}
Write-Host ''
Write-Host 'Bitti. Durum icin: server\service\status.ps1   Kaldirmak icin: server\service\uninstall-services.ps1'
