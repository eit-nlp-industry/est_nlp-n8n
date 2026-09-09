. "$PSScriptRoot\_common.ps1"

# Stop Instance AI demo: n8n process + sandbox containers.
# Usage: powershell -File demo\stop-instance-ai.ps1

$pidPath = Join-Path $DemoDir 'n8n.pid'
$envFile = Join-Path $RepoRoot 'packages\cli\bin\.env'
$composeFile = Join-Path $DemoDir 'sandbox-compose.yml'

Write-Host 'Stopping n8n...'
if (Test-Path $pidPath) {
	$n8nPid = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
	if ($n8nPid -match '^\d+$') {
		Stop-Process -Id ([int]$n8nPid) -Force -ErrorAction SilentlyContinue
		Get-CimInstance Win32_Process -Filter "ParentProcessId=$n8nPid" -ErrorAction SilentlyContinue |
			ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
	}
	Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
}

Get-NetTCPConnection -LocalPort 5678,5720 -State Listen -ErrorAction SilentlyContinue |
	Select-Object -ExpandProperty OwningProcess -Unique |
	ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
if ($env:N8N_PORT -and $env:N8N_PORT -notin @('5678','5720')) {
	Get-NetTCPConnection -LocalPort ([int]$env:N8N_PORT) -State Listen -ErrorAction SilentlyContinue |
		Select-Object -ExpandProperty OwningProcess -Unique |
		ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

Write-Host 'Stopping sandbox containers...'
# docker compose writes progress to stderr; PowerShell treats that as a terminating error.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
docker compose -f $composeFile down --remove-orphans 2>&1 | Out-Null
$ids = docker ps -aq --filter 'name=n8n-svc-' 2>$null
if ($ids) { docker rm -f $ids 2>&1 | Out-Null }
docker network rm n8n-instance-ai-dev 2>&1 | Out-Null
$ErrorActionPreference = $prevEap
if (Test-Path $envFile) {
	Remove-Item $envFile -Force -ErrorAction SilentlyContinue
}

Write-Host 'Stopped. Docker Desktop itself is still running (that is fine).'
Write-Host 'Start again with: powershell -File demo\start-instance-ai.ps1'
