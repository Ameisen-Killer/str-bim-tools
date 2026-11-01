@echo off
rem Atelier STR - STR BIM Tools - Tony VARIN
rem Cree sur le bureau Windows un raccourci qui ouvre l'Atelier STR en plein ecran.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; iex ((Get-Content -LiteralPath $f -Raw -Encoding UTF8) -split '#PS#',3)[2]"
pause
exit /b
#PS#
$ErrorActionPreference = 'Stop'
Write-Host 'Atelier STR - STR BIM Tools - Tony VARIN'
Write-Host ''
$url     = 'https://str-bim-tools.com/atelier/'
$dossier = Join-Path $env:LOCALAPPDATA 'STR BIM Tools\Atelier'
New-Item -ItemType Directory -Force -Path $dossier | Out-Null

# Icone de l'atelier, gardee sur le poste
$ico = Join-Path $dossier 'atelier.ico'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest 'https://str-bim-tools.com/atelier/atelier.ico' -OutFile $ico -UseBasicParsing
} catch { Write-Host "Icone non telechargee : le raccourci prendra celle du navigateur."; $ico = $null }

# Chrome s'il est installe, sinon Edge (present sur tout Windows)
$candidats = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$nav = $candidats | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $nav) { Write-Host 'Ni Chrome ni Edge trouve : raccourci non cree.'; return }

# Fenetre d'application en plein ecran, avec un profil a part :
# sans lui, un navigateur deja ouvert ignorerait la demande de plein ecran.
$profil = Join-Path $dossier 'profil'
$arguments = "--app=$url --start-fullscreen --user-data-dir=`"$profil`" --no-first-run --no-default-browser-check"

$bureau = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $bureau 'Atelier STR.lnk'
$sh = New-Object -ComObject WScript.Shell
$r = $sh.CreateShortcut($lnk)
$r.TargetPath = $nav
$r.Arguments = $arguments
$r.WorkingDirectory = $dossier
$r.Description = 'Atelier STR - STR BIM Tools - Tony VARIN'
if ($ico) { $r.IconLocation = "$ico,0" }
$r.Save()
Write-Host "Raccourci cree : $lnk"
Write-Host "Navigateur : $nav"
Write-Host 'Pour sortir du plein ecran : F11 ou le bouton de la barre. Pour fermer : bouton Eteindre.'
