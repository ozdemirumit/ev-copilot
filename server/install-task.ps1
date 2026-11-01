# Windows açılışında ara sunucuyu kendiliğinden başlatan zamanlanmış görev kurar (yönetici gerekmez; oturum açınca başlar).
# Kaldırmak için: Unregister-ScheduledTask -TaskName 'EVCoPilotProxy' -Confirm:$false
$script = Join-Path $PSScriptRoot 'start.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'EVCoPilotProxy' -Action $action -Trigger $trigger -Settings $settings -Description 'EV Co-Pilot ara sunucusu' -Force | Out-Null
Start-ScheduledTask -TaskName 'EVCoPilotProxy'
Write-Host 'Görev kuruldu ve başlatıldı: EVCoPilotProxy'
