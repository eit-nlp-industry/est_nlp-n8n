# Resets the demo instance owner shell user so bootstrap-owner.ps1 can seed known credentials.
# n8n must be STOPPED before running this (SQLite lock).
#
# Usage (from repo root):
#   .\demo\reset-demo-owner.ps1
#   # then start n8n and run .\demo\bootstrap-owner.ps1

param(
	[string]$HostName = '127.0.0.1',
	[int]$Port = 5720
)

$ErrorActionPreference = 'Stop'

function Import-EnvFile {
	param([string]$Path)

	if (-not (Test-Path $Path)) {
		return
	}

	Get-Content $Path | ForEach-Object {
		$line = $_.Trim()
		if ($line -eq '' -or $line.StartsWith('#')) {
			return
		}

		$separator = $line.IndexOf('=')
		if ($separator -lt 1) {
			return
		}

		$name = $line.Substring(0, $separator).Trim()
		$value = $line.Substring($separator + 1).Trim()
		if (
			($value.StartsWith('"') -and $value.EndsWith('"')) -or
			($value.StartsWith("'") -and $value.EndsWith("'"))
		) {
			$value = $value.Substring(1, $value.Length - 2)
		}

		Set-Item -Path "env:$name" -Value $value
	}
}

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot
Import-EnvFile (Join-Path $repoRoot '.env.local')

if (-not $env:N8N_USER_FOLDER) {
	$env:N8N_USER_FOLDER = (Join-Path $repoRoot 'demo\.n8n-data')
}

if ($env:N8N_PORT) {
	$Port = [int]$env:N8N_PORT
}

$healthUrl = "http://${HostName}:$Port/healthz"
try {
	$response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
	if ($response.StatusCode -eq 200) {
		Write-Error "n8n is still running on port $Port. Stop it (Ctrl+C) before resetting the owner."
		exit 1
	}
} catch {
	# expected when n8n is stopped
}

Write-Host "Resetting owner in $env:N8N_USER_FOLDER ..."
node packages/cli/bin/n8n user-management:reset

Write-Host ""
Write-Host "Owner reset complete. Next:"
Write-Host "  1. Start n8n (see demo docs or your usual start command)"
Write-Host "  2. .\demo\bootstrap-owner.ps1"
Write-Host "  3. Sign in with admin@local.dev / LocalDev123! (or DEMO_OWNER_* from .env.local)"
