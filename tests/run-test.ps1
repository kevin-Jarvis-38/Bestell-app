# Startet test.html in einem unsichtbaren Chrome und gibt das Ergebnis aus.
# Vorher muss server.ps1 laufen.
$result = Join-Path $PSScriptRoot 'result.txt'
Remove-Item $result -ErrorAction SilentlyContinue
$profile = Join-Path $env:TEMP 'bestellapp-chrome-test'
$chrome = Start-Process "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" -PassThru -ArgumentList @(
  '--headless=new', '--disable-gpu', "--user-data-dir=$profile", '--remote-debugging-port=0', 'http://localhost:8765/tests/test.html')
$deadline = (Get-Date).AddSeconds(60)
while (-not (Test-Path $result) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
Stop-Process -Id $chrome.Id -Force -ErrorAction SilentlyContinue
if (Test-Path $result) { Get-Content $result -Encoding UTF8 } else { 'Kein Ergebnis nach 60 Sekunden.' }
