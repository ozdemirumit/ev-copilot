# Sunucu veri klasorundeki db.json (kullanicilar, davetler, senkron ve gecmis) dosyasini tarih damgasiyla yedekler; son $Keep yedek tutulur.
# Kaynak: server\.env icindeki DATA_DIR (yoksa server\data). Yedeklenmeden once db.json'un GECERLI JSON oldugu denetlenir: bozuk dosya
# yedeklenmez (eski saglam yedekleri dongu disina itmesin) ve <Dest>\backup.log'a yazilir.
# db.json atomik yazilir (gecici dosya + yeniden adlandirma), calisirken kopyalamak guvenlidir. Zamanlanmis gorev her gun 03:30'da calistirir.
# Baska bir diske/surucuye yedek icin: -Dest "E:\EVCoPilotYedek". Dosya bilerek ASCII.
param(
  [string]$Dest = 'C:\ProgramData\EVCoPilot\backup',
  [string]$Src,
  [int]$Keep = 14
)
function Get-DataDir {
  $server = Split-Path -Parent $PSScriptRoot
  $envFile = Join-Path $server '.env'
  if (Test-Path $envFile) {
    $l = Get-Content $envFile | Where-Object { $_ -match '^\s*DATA_DIR\s*=' } | Select-Object -Last 1
    if ($l) { $v = ($l -replace '^\s*DATA_DIR\s*=\s*', '').Trim().Trim('"').Trim("'"); if ($v) { return $v } }
  }
  return (Join-Path $server 'data')
}
if (-not $Src) { $Src = Join-Path (Get-DataDir) 'db.json' }
if (-not (Test-Path $Src)) { exit 0 }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$log = Join-Path $Dest 'backup.log'
try {
  $null = Get-Content $Src -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Add-Content -Path $log -Value ("{0} BOZUK: {1} gecerli JSON degil, yedeklenmedi ({2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Src, $_.Exception.Message)
  exit 1
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
Copy-Item $Src (Join-Path $Dest "db-$stamp.json") -Force
Get-ChildItem $Dest -Filter 'db-*.json' | Where-Object { $_.Name -notlike 'db-oncesi-*' } | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item -Force
