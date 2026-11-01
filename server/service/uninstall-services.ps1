# Hizmetleri, gorevleri ve guvenlik duvari kuralini kaldirir (veri, yedekler ve .env silinmez). YONETICI olarak calistir. Dosya bilerek ASCII.
$ErrorActionPreference = 'Continue'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Host 'Yonetici olarak calistirilmali.' -ForegroundColor Red; exit 1 }
$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { $nssm = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter 'nssm.exe' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1 -ExpandProperty FullName }
foreach ($n in 'EVCoPilotProxy', 'EVCoPilotCaddy') {
  if (Get-Service $n -ErrorAction SilentlyContinue) {
    Stop-Service $n -Force -ErrorAction SilentlyContinue
    if ($nssm) { & $nssm remove $n confirm | Out-Null } else { sc.exe delete $n | Out-Null }
    Write-Host "Kaldirildi: $n"
  }
}
foreach ($t in 'EVCoPilotBackup', 'EVCoPilotWatchdog') { if (Get-ScheduledTask $t -ErrorAction SilentlyContinue) { Unregister-ScheduledTask $t -Confirm:$false; Write-Host "Kaldirildi: $t" } }
Get-NetFirewallRule -DisplayName 'EV Co-Pilot HTTPS (443)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Tamam. Veriler C:\ProgramData\EVCoPilot altinda ve server\data icinde duruyor.'
