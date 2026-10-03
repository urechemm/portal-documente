param([string]$OutputDirectory = 'documente-upload')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localNode = Join-Path $PSScriptRoot 'tools\node-v22.22.0-win-x64'
$sharedNode = 'C:\Users\Mihai\.codex\My Projects\Confirmari sold\tools\node-v22.22.0-win-x64'
if (Test-Path -LiteralPath (Join-Path $localNode 'node.exe')) { $env:Path = $localNode + ';' + $env:Path }
elseif (Test-Path -LiteralPath (Join-Path $sharedNode 'node.exe')) { $env:Path = $sharedNode + ';' + $env:Path }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js / npm nu a fost găsit. Instalați Node.js 22 sau copiați runtime-ul portabil în folderul tools.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    Write-Host 'Instalez dependențele...'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'Instalarea dependențelor a eșuat.' }

}
Write-Host 'Construiesc Portal Documente...'
& npm.cmd run build -- --outDir $OutputDirectory --emptyOutDir
if ($LASTEXITCODE -ne 0) { throw 'Build-ul a eșuat.' }
    Compress-Archive -Path "$PSScriptRoot\$OutputDirectory\*" -DestinationPath "$PSScriptRoot\$OutputDirectory\$OutputDirectory.zip" -Force
    Write-Host "Folder pentru Celentis cPanel: $PSScriptRoot\$OutputDirectory"
    Write-Host "Arhiva ZIP: $PSScriptRoot\$OutputDirectory.zip"
