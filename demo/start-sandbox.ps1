# Start n8n Sandbox (API + runner) for Instance AI onboarding.
# Cleans up leftover containers/network from failed runs on Windows.
#
# Usage (from repo root):
#   .\demo\start-sandbox.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host "Removing leftover sandbox containers..." -ForegroundColor Cyan
docker ps -aq --filter "name=n8n-svc-sandbox" | ForEach-Object {
	if ($_) { docker rm -f $_ | Out-Null }
}

Write-Host "Pre-pulling sandbox images (avoids OOM during startup)..." -ForegroundColor Cyan
docker pull n8nio/n8n-sandbox-service-api:latest
docker pull n8nio/n8n-sandbox-service-runner-dind:latest
docker pull n8nio/n8n-sandbox-service-sandbox:latest

Write-Host "Starting sandbox stack (may take 2-5 minutes)..." -ForegroundColor Cyan
$env:TESTCONTAINERS_REUSE_ENABLE = 'true'
pnpm --filter n8n-containers services --services sandbox --network n8n-instance-ai-dev --name n8n-svc-sandbox

Write-Host ""
Write-Host "Containers:" -ForegroundColor Green
docker ps --filter "name=n8n-svc-sandbox" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

$port = docker port n8n-svc-sandbox-sandbox-api 8080/tcp 2>$null
if ($port) {
	Write-Host ""
	Write-Host "Sandbox API URL: http://localhost:$($port.Split(':')[-1])" -ForegroundColor Green
	Write-Host "API key: n8n-sandbox-ci-key" -ForegroundColor Green
}
