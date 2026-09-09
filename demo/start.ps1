. "$PSScriptRoot\_common.ps1"

Use-Pnpm
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$env:N8N_USER_FOLDER = $DataDir
$env:N8N_DIAGNOSTICS_ENABLED = 'false'
$env:N8N_SECURE_COOKIE = 'false'

Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
	Write-Host 'Installing dependencies (corepack pnpm install)...'
	corepack pnpm install
}

$cliDist = Join-Path $RepoRoot 'packages\cli\dist'
$editorDist = Join-Path $RepoRoot 'packages\frontend\editor-ui\dist'
if (-not (Test-Path $cliDist) -or -not (Test-Path $editorDist)) {
	Write-Host 'Building monorepo (this takes a while)...'
	corepack pnpm build
}

Write-Host "Starting n8n at $BaseUrl (data: $DataDir)"
corepack pnpm start
