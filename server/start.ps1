# Ara sunucuyu başlatır (çökerse 5 sn sonra yeniden başlatır). Günlük: server/proxy.log
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
while ($true) {
  & $node .\proxy.mjs *>> .\proxy.log
  Start-Sleep -Seconds 5
}
