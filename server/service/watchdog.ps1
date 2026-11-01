# Saglik denetimi (5 dakikada bir, zamanlanmis gorev): servis calisiyor ama yanit vermiyorsa (takilma) yeniden baslatir.
# 1) Ara sunucu: http://127.0.0.1:8787/v1/config  2) Caddy: yerel https (curl --resolve ile, ev agindan genel adrese cikmadan).
# Iki ardisik basarisizlikta (10 sn arayla) ilgili hizmeti yeniden baslatir. Gunluk: <Logs>\watchdog.log (1 MB'ta kesilir). Dosya bilerek ASCII.
param([string]$Logs = 'C:\ProgramData\EVCoPilot\logs', [string]$HostName = 'evcopilot.duckdns.org')
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$log = Join-Path $Logs 'watchdog.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.old" -Force }
function Log([string]$m) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }

function Ok-Proxy { $r = & curl.exe -s -m 8 http://127.0.0.1:8787/v1/config 2>$null; return ($r -match 'providers') }
function Ok-Caddy { $r = & curl.exe -s -m 10 --resolve "${HostName}:443:127.0.0.1" "https://$HostName/v1/config" 2>$null; return ($r -match 'providers') }

function Check([string]$name, [scriptblock]$test) {
  $svc = Get-Service $name -ErrorAction SilentlyContinue
  if (-not $svc) { return }
  if ($svc.Status -ne 'Running') { Log "$name calismiyor ($($svc.Status)): baslatiliyor"; Start-Service $name -ErrorAction SilentlyContinue; return }
  if (& $test) { return }
  Start-Sleep -Seconds 10
  if (& $test) { return }
  Log "$name yanit vermiyor: yeniden baslatiliyor"
  Restart-Service $name -Force -ErrorAction SilentlyContinue
}
Check 'EVCoPilotProxy' { Ok-Proxy }
Check 'EVCoPilotCaddy' { Ok-Caddy }
