# Macht Screenshots der App in Handygröße (412 px breit) mit Beispieldaten. Vorher muss server.ps1 laufen.
param([string]$OutDir = $PSScriptRoot)
Add-Type -AssemblyName System.Drawing
$chromeExe = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$profile = Join-Path $env:TEMP 'bestellapp-chrome-shots'
foreach ($shot in @(
    @{ name = 'zaehlen'; query = 'view=count'; dark = $false },
    @{ name = 'bestellliste'; query = 'view=order'; dark = $false },
    @{ name = 'zaehlen-dunkel'; query = 'view=count'; dark = $true },
    @{ name = 'produkt-bearbeiten'; query = 'view=count&edit=p6'; dark = $false })) {
  $raw = Join-Path $env:TEMP "bestellapp-$($shot.name)-roh.png"
  & $chromeExe --headless=new --disable-gpu "--user-data-dir=$profile" --hide-scrollbars --window-size=800,915 `
    --force-device-scale-factor=1 "--blink-settings=preferredColorScheme=$(if ($shot.dark) { 0 } else { 1 })" `
    --virtual-time-budget=5000 "--screenshot=$raw" "http://localhost:8765/tests/demo.html?$($shot.query)" 2>$null | Out-Null
  # Auf die Handybreite zuschneiden
  $src = [System.Drawing.Image]::FromFile($raw)
  $dst = New-Object System.Drawing.Bitmap 412, 915
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, 412, 915), (New-Object System.Drawing.Rectangle 0, 0, 412, 915), 'Pixel')
  $g.Dispose(); $src.Dispose()
  $file = Join-Path $OutDir "$($shot.name).png"
  $dst.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $dst.Dispose()
  Remove-Item $raw
  $file
}
