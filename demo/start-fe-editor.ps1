# Start editor-ui Vite dev server (hot reload). Requires demo/start-n8n.ps1 already running.
# Default editor port is 8080; if it is taken (often Docker/WSL), picks the next free port.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

function Test-TcpPortInUse {
	param([int]$Port)
	# Wrap in @(): a single Get-NetTCPConnection result has no .Count in PowerShell.
	$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
	if ($listeners.Count -gt 0) {
		return $true
	}
	try {
		return Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue |
			Select-Object -ExpandProperty TcpTestSucceeded
	} catch {
		return $false
	}
}

function Get-FirstFreePort {
	param([int[]]$Candidates)
	foreach ($port in $Candidates) {
		if (-not (Test-TcpPortInUse -Port $port)) {
			return $port
		}
	}
	throw "No free port found in: $($Candidates -join ', ')"
}

function Read-N8nPortFromEnvLocal {
	$envFile = Join-Path $repoRoot '.env.local'
	if (-not (Test-Path $envFile)) {
		return $null
	}
	foreach ($line in Get-Content $envFile) {
		if ($line -match '^\s*N8N_PORT\s*=\s*"?(\d+)"?\s*$') {
			return [int]$Matches[1]
		}
	}
	return $null
}

$backendPort = Read-N8nPortFromEnvLocal
if (-not $backendPort) {
	$backendPort = if ($env:N8N_PORT) { [int]$env:N8N_PORT } else { 5678 }
}

if (-not (Test-TcpPortInUse -Port $backendPort)) {
	Write-Host "Backend is not listening on port $backendPort."
	Write-Host "Start it first in another terminal:"
	Write-Host "  .\demo\start-n8n.ps1"
	Write-Host ""
	exit 1
}

$preferredEditorPort = if ($env:N8N_EDITOR_PORT) { [int]$env:N8N_EDITOR_PORT } else { 8080 }
$candidates = @($preferredEditorPort) + (8081..8090)
$editorPort = Get-FirstFreePort -Candidates $candidates
$env:N8N_EDITOR_PORT = "$editorPort"
$env:N8N_PORT = "$backendPort"

Write-Host ""
Write-Host "1) Backend (keep running):  http://localhost:$backendPort/"
Write-Host "2) Editor UI (open this):   http://localhost:$editorPort/"
if ($editorPort -ne $preferredEditorPort) {
	Write-Host "Note: Port $preferredEditorPort was in use; using $editorPort (often Docker uses 8080)."
}
Write-Host "Vite will call the API at http://localhost:$backendPort/ (from .env.local N8N_PORT)."
Write-Host ""

$envFile = Join-Path $repoRoot '.env.local'
if (Test-Path $envFile) {
	pnpm exec -- dotenvx run -f .env.local -- pnpm dev:fe:editor
} else {
	pnpm dev:fe:editor
}
