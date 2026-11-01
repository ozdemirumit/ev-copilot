# Ara sunucuyu Windows oturumu acilinca kendiliginden baslatir (dosya bilerek ASCII: Windows PowerShell 5.1 BOM'suz UTF-8'i bozar).
# 1) Zamanlanmis gorev dener (bazi bilgisayarlarda yonetici izni ister).
# 2) Izin yoksa Baslangic klasorune kisayol koyar (yonetici gerekmez) ve sunucuyu hemen baslatir.
# Kaldirmak icin: Unregister-ScheduledTask -TaskName 'EVCoPilotProxy' -Confirm:$false   ya da   Baslangic klasorundeki EVCoPilotProxy.lnk dosyasini sil.
$script = Join-Path $PSScriptRoot 'start.ps1'
$psArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'EVCoPilotProxy' -Action $action -Trigger $trigger -Settings $settings -Description 'EV Co-Pilot ara sunucusu' -Force -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName 'EVCoPilotProxy' -ErrorAction Stop
  Write-Host 'Zamanlanmis gorev kuruldu ve baslatildi: EVCoPilotProxy'
} catch {
  Write-Host ('Zamanlanmis gorev kurulamadi (' + $_.Exception.Message.Trim() + '). Baslangic klasoru yontemi kullaniliyor.')
  $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'EVCoPilotProxy.lnk'
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = 'powershell.exe'
  $s.Arguments = $psArgs
  $s.WorkingDirectory = $PSScriptRoot
  $s.WindowStyle = 7
  $s.Save()
  Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs -WindowStyle Hidden
  Write-Host ('Baslangic kisayolu olusturuldu: ' + $lnk + ' - sunucu baslatildi.')
}
