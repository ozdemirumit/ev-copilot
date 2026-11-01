# server\data\db.json (kullanicilar, davetler, senkron ve gecmis) dosyasini tarih damgasiyla yedekler; son $Keep yedek tutulur.
# db.json atomik yazilir (gecici dosya + yeniden adlandirma), calisirken kopyalamak guvenlidir. Zamanlanmis gorev her gun 03:30'da calistirir.
# Baska bir diske/surucuye yedek icin: -Dest "E:\EVCoPilotYedek". Dosya bilerek ASCII.
param(
  [string]$Dest = 'C:\ProgramData\EVCoPilot\backup',
  [string]$Src = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data\db.json'),
  [int]$Keep = 14
)
if (-not (Test-Path $Src)) { exit 0 }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
Copy-Item $Src (Join-Path $Dest "db-$stamp.json") -Force
Get-ChildItem $Dest -Filter 'db-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item -Force
