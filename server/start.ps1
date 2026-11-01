# Ara sunucuyu baslatir; cokerse 5 sn sonra yeniden baslatir. Gunluk: server\proxy.log (dosya bilerek ASCII: Windows PowerShell 5.1 BOM'suz UTF-8'i bozar).
# Yonlendirme cmd.exe ile yapilir: PowerShell 5.1 native komutun stderr satirlarini hata sayip betigi sonlandirabiliyor
# (ara sunucu hatalari console.error ile stderr'e yazar), bu da dongunun ve sunucunun kapanmasina yol aciyordu.
Set-Location -LiteralPath $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
while ($true) {
  cmd.exe /c "`"$node`" proxy.mjs >> proxy.log 2>&1"
  Start-Sleep -Seconds 5
}
