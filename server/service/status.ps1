# Durum: hizmetler, zamanlanmis gorevler, yanitlar ve son gunluk satirlari. Normal PowerShell yeterli. Dosya bilerek ASCII.
param([string]$BaseDir = 'C:\ProgramData\EVCoPilot')
Write-Host '--- Hizmetler'
Get-Service EVCoPilotProxy, EVCoPilotCaddy -ErrorAction SilentlyContinue | Format-Table Name, Status, StartType -AutoSize
Write-Host '--- Gorevler'
Get-ScheduledTask EVCoPilotBackup, EVCoPilotWatchdog -ErrorAction SilentlyContinue | Get-ScheduledTaskInfo | Format-Table TaskName, LastRunTime, LastTaskResult -AutoSize
Write-Host '--- Yanitlar'
Write-Host ("yerel   : " + (& curl.exe -s -m 8 http://127.0.0.1:8787/v1/config))
Write-Host ("https   : " + (& curl.exe -s -m 15 --resolve evcopilot.duckdns.org:443:127.0.0.1 https://evcopilot.duckdns.org/v1/config))
Write-Host '--- Son gunluk satirlari'
foreach ($f in 'proxy.err.log', 'proxy.out.log', 'caddy.err.log', 'watchdog.log') {
  $p = Join-Path $BaseDir "logs\$f"
  if (Test-Path $p) { Write-Host "[$f]"; Get-Content $p -Tail 4 | ForEach-Object { if ($_.Length -gt 200) { $_.Substring(0, 200) } else { $_ } } }
}
$bk = Get-ChildItem (Join-Path $BaseDir 'backup') -Filter 'db-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($bk) { Write-Host "--- Son yedek: $($bk.Name) ($($bk.LastWriteTime))" } else { Write-Host '--- Yedek henuz yok' }
