# Start sandbox via Docker Compose (Windows-friendly).
# Pre-loads the sandbox image into the runner's inner Docker to avoid OOM during
# in-container docker pull (signal: killed).
#
# Usage (from repo root):
#   .\demo\start-sandbox-compose.ps1

$ErrorActionPreference = 'Stop'
$DemoDir = $PSScriptRoot
Set-Location $DemoDir

$SandboxImage = 'n8nio/n8n-sandbox-service-sandbox:latest'
$RunnerName = 'n8n-svc-sandbox-sandbox-runner-1'
$ApiName = 'n8n-svc-sandbox-sandbox-api'

Write-Host "Stopping leftover sandbox containers..." -ForegroundColor Cyan
docker ps -aq --filter "name=n8n-svc-sandbox" | ForEach-Object {
	if ($_) { docker rm -f $_ | Out-Null }
}

Write-Host "Pre-pulling images on host..." -ForegroundColor Cyan
docker pull n8nio/n8n-sandbox-service-api:latest
docker pull n8nio/n8n-sandbox-service-runner-dind:latest
docker pull $SandboxImage

Write-Host "Starting compose stack..." -ForegroundColor Cyan
docker compose -f docker-compose.sandbox.yml up -d

Write-Host "Waiting for runner container to appear..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
	$state = docker inspect -f '{{.State.Running}}' $RunnerName 2>$null
	if ($state -eq 'true') { break }
	Start-Sleep -Seconds 3
}
if ($LASTEXITCODE -ne 0 -or (docker inspect -f '{{.State.Running}}' $RunnerName 2>$null) -ne 'true') {
	throw "Runner container did not start. Check: docker logs $RunnerName"
}

Write-Host "Pre-loading sandbox image into runner (avoids DinD pull OOM)..." -ForegroundColor Cyan
# PowerShell corrupts binary pipes; use cmd for docker save | docker load.
cmd /c "docker save $SandboxImage | docker exec -i $RunnerName docker load"

Write-Host "Restarting runner so it picks up the pre-loaded image..." -ForegroundColor Cyan
docker restart $RunnerName | Out-Null

Write-Host "Waiting for runner health (up to 5 min)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(5)
$ready = $false
while ((Get-Date) -lt $deadline) {
	$health = docker inspect -f '{{.State.Health.Status}}' $RunnerName 2>$null
	if ($health -eq 'healthy') { $ready = $true; break }
	$logs = docker logs $RunnerName 2>&1 | Select-Object -Last 3
	Write-Host "  runner health: $health  ($logs)" -ForegroundColor DarkGray
	Start-Sleep -Seconds 10
}

Write-Host ""
Write-Host "Containers:" -ForegroundColor Green
docker ps --filter "name=n8n-svc-sandbox" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

Write-Host ""
Write-Host "Testing sandbox creation..." -ForegroundColor Cyan
$response = curl.exe -s -X POST -H "X-Api-Key: n8n-sandbox-ci-key" http://localhost:8080/sandboxes
Write-Host $response

if ($response -match '"id"') {
	Write-Host ""
	Write-Host "Sandbox ready!" -ForegroundColor Green
	Write-Host "Service URL: http://localhost:8080" -ForegroundColor Green
	Write-Host "API key:     n8n-sandbox-ci-key" -ForegroundColor Green
} elseif (-not $ready) {
	Write-Host ""
	Write-Host "Runner not healthy yet. Check logs:" -ForegroundColor Yellow
	Write-Host "  docker logs $RunnerName" -ForegroundColor Yellow
	exit 1
} else {
	Write-Host ""
	Write-Host "Runner is up but sandbox creation failed. Check API logs:" -ForegroundColor Yellow
	Write-Host "  docker logs $ApiName" -ForegroundColor Yellow
	exit 1
}
