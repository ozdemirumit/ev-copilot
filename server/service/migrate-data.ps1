# Sunucu veri klasorunu (hesaplar, oturumlar, fotograflar) gelistirme klasorunden kalici yere tasir: C:\ProgramData\EVCoPilot\data. Dosya bilerek ASCII.
# YONETICI PowerShell gerekir. Once -DryRun ile dene (hicbir sey degistirmez):
#   powershell -ExecutionPolicy Bypass -File server\service\migrate-data.ps1 -DryRun
#   powershell -ExecutionPolicy Bypass -File server\service\migrate-data.ps1
# Adimlar: db.json ve .env yedegi -> hizmet durur -> veri KOPYALANIR (eski klasore dokunulmaz) -> dosya sayisi + db.json SHA256 dogrulanir ->
# LocalService yazma izni -> .env icinde DATA_DIR yazilir -> hizmet baslar ve yoklanir -> yedek/denetim gorevleri bu klasordeki betiklere cevrilir.
# Yoklama basarisizsa .env yedeginden geri doner (Geri al). Eski veri klasoru ELLE silinir (birkac gun gozlemledikten sonra).
param(
  [string]$Target = 'C:\ProgramData\EVCoPilot\data',
  [string]$Repo,
  [string]$BaseDir = 'C:\ProgramData\EVCoPilot',
  [string]$Base = 'http://127.0.0.1:8787',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
function Say([string]$m) { Write-Host $m }
function Fail([string]$m) { Write-Host "HATA: $m" -ForegroundColor Red; exit 1 }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $DryRun) { Fail 'Yonetici olarak calistirilmali (PowerShell > Yonetici olarak calistir). Once -DryRun ile deneyebilirsin.' }

$svc = 'EVCoPilotProxy'
$server = Join-Path $Repo 'server'
$envFile = Join-Path $server '.env'
if (-not (Test-Path $envFile)) { Fail "server\.env yok: $server" }

function Get-DataDir {
  $l = Get-Content $envFile | Where-Object { $_ -match '^\s*DATA_DIR\s*=' } | Select-Object -Last 1
  if ($l) { $v = ($l -replace '^\s*DATA_DIR\s*=\s*', '').Trim().Trim('"').Trim("'"); if ($v) { return $v } }
  return (Join-Path $server 'data')
}
$old = Get-DataDir
$norm = { param($p) [IO.Path]::GetFullPath($p).TrimEnd('\').ToLowerInvariant() }
if ((& $norm $old) -eq (& $norm $Target)) { Say "Veri zaten hedefte: $Target"; exit 0 }
if (-not (Test-Path (Join-Path $old 'db.json'))) { Fail "Kaynakta db.json yok: $old" }
$files = @(Get-ChildItem $old -Recurse -File)
Say "Kaynak : $old ($($files.Count) dosya, $([math]::Round((($files | Measure-Object Length -Sum).Sum) / 1KB)) KB)"
Say "Hedef  : $Target"
Say "Hizmet : $svc (durdurulup yeniden baslatilacak; birkac saniye kesinti)"
if ($DryRun) { Say '*** KURU CALISTIRMA: hicbir sey degistirilmedi ***'; exit 0 }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bk = Join-Path $BaseDir 'backup'
New-Item -ItemType Directory -Force -Path $bk | Out-Null
$dbBak = Join-Path $bk "db-oncesi-tasima-$stamp.json"
$envBak = Join-Path $bk ".env.bak-$stamp"
Copy-Item (Join-Path $old 'db.json') $dbBak -Force
Copy-Item $envFile $envBak -Force
icacls $envBak /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null   # .env yedegi yalniz SYSTEM + yoneticiler
Say "Yedekler: $dbBak ve $envBak"

function Probe { for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; $r = & curl.exe -s -m 5 "$Base/v1/config" 2>$null; if ($r -match 'providers') { return $true } }; return $false }
function Rollback([string]$why) {
  Write-Host "SORUN: $why - Geri al: .env yedegi geri yukleniyor, hizmet eski veri klasoruyle baslatiliyor." -ForegroundColor Yellow
  Copy-Item $envBak $envFile -Force
  Stop-Service $svc -Force -ErrorAction SilentlyContinue
  Start-Service $svc
  if (Probe) { Write-Host 'Geri alindi: hizmet eski veri klasorunden calisiyor.' -ForegroundColor Yellow } else { Write-Host 'UYARI: geri almadan sonra da yanit yok; status.ps1 ile kontrol et.' -ForegroundColor Red }
  exit 2
}

Stop-Service $svc -Force
try {
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  Copy-Item (Join-Path $old '*') $Target -Recurse -Force
  $copied = @(Get-ChildItem $Target -Recurse -File)
  if ($copied.Count -lt $files.Count) { throw "dosya sayisi tutmuyor ($($copied.Count) < $($files.Count))" }
  $h1 = (Get-FileHash (Join-Path $old 'db.json') -Algorithm SHA256).Hash
  $h2 = (Get-FileHash (Join-Path $Target 'db.json') -Algorithm SHA256).Hash
  if ($h1 -ne $h2) { throw 'db.json SHA256 tutmuyor' }
  icacls $Target /grant '*S-1-5-19:(OI)(CI)M' | Out-Null   # LocalService: yazma
  $lines = @(Get-Content $envFile)
  $hit = $false
  $lines = @($lines | ForEach-Object { if ($_ -match '^\s*DATA_DIR\s*=') { $hit = $true; "DATA_DIR=$Target" } else { $_ } })
  if (-not $hit) { $lines += "DATA_DIR=$Target" }
  [IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
} catch {
  Rollback ("tasima basarisiz: " + $_.Exception.Message)
}
Start-Service $svc
if (-not (Probe)) { Rollback 'hizmet yeni veri klasoruyle yanit vermedi' }
Say 'Hizmet yeni veri klasoruyle yanit veriyor.'

# Yedek ve saglik gorevleri bu klasordeki betikleri kullansin (eski gelistirme klasorune bagli kalmasin)
function Update-Task([string]$name, [string]$script, [string]$extra) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $task) { Say "Gorev yok, atlandi: $name"; return }
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" $extra"
  Set-ScheduledTask -TaskName $name -Action $act | Out-Null
  Say "Gorev guncellendi: $name -> $script"
}
Update-Task 'EVCoPilotBackup' (Join-Path $PSScriptRoot 'backup.ps1') "-Dest `"$bk`""
Update-Task 'EVCoPilotWatchdog' (Join-Path $PSScriptRoot 'watchdog.ps1') "-Logs `"$(Join-Path $BaseDir 'logs')`""

Say ''
Say 'Bitti. Eski veri klasoru yerinde duruyor (silinmedi):'
Say "  $old"
Say 'Birkac gun sorunsuz calistiktan sonra elle silebilirsin. Dogrulama: node scripts\verify-backup.mjs --dir "' + $bk + '"'
