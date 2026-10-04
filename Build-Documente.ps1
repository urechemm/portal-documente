param(
    [string]$OutputDirectory = 'documente-upload',
    [string]$SupabaseUrl = 'https://iekirbhyctllpvqnvnzk.supabase.co',
    [string]$SupabasePublishableKey = 'sb_publishable_jWmQxdOgRfFyIGOSF8njCg_IKIxWwqP'
)
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
if (-not $SupabaseUrl) { $SupabaseUrl = Read-Host 'Supabase Project URL' }
if (-not $SupabasePublishableKey) { $SupabasePublishableKey = Read-Host 'Supabase publishable key' }
if (-not $SupabaseUrl -or -not $SupabasePublishableKey) { throw 'Configurația Supabase este obligatorie pentru build-ul LIVE.' }

$runtimeConfig = Join-Path $PSScriptRoot 'public\runtime-config.json'
$previousRuntimeConfig = if (Test-Path -LiteralPath $runtimeConfig) { Get-Content -Raw -LiteralPath $runtimeConfig } else { $null }
try {
    @{
        supabaseUrl = $SupabaseUrl.TrimEnd('/')
        supabasePublishableKey = $SupabasePublishableKey
        environment = 'production'
    } | ConvertTo-Json | Set-Content -LiteralPath $runtimeConfig -Encoding UTF8
    Write-Host 'Construiesc Portal Documente LIVE...'
    & npm.cmd run build -- --outDir $OutputDirectory --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw 'Build-ul a eșuat.' }
    $zipPath = Join-Path $PSScriptRoot "$OutputDirectory.zip"
    Compress-Archive -Path "$PSScriptRoot\$OutputDirectory\*" -DestinationPath $zipPath -Force
    Write-Host "Folder pentru Celentis cPanel: $PSScriptRoot\$OutputDirectory"
    Write-Host "Arhiva ZIP: $zipPath"
} finally {
    if ($null -ne $previousRuntimeConfig) { Set-Content -LiteralPath $runtimeConfig -Value $previousRuntimeConfig -Encoding UTF8 }
    elseif (Test-Path -LiteralPath $runtimeConfig) { Remove-Item -LiteralPath $runtimeConfig -Force }
}
