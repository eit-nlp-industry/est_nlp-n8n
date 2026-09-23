# Seeds the instance owner for local demo data (demo/.n8n-data).
# Safe to run repeatedly: skips when owner is already set up.
#
# Usage (from repo root, while n8n is running):
#   .\demo\bootstrap-owner.ps1
#
# Optional credentials in .env.local (gitignored):
#   DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD, DEMO_OWNER_FIRST_NAME, DEMO_OWNER_LAST_NAME

param(
	[string]$HostName = '127.0.0.1',
	[int]$Port = 5720,
	[int]$TimeoutSeconds = 120
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
Import-EnvFile (Join-Path $repoRoot '.env.local')

if ($env:N8N_PORT) {
	$Port = [int]$env:N8N_PORT
}

$email = if ($env:DEMO_OWNER_EMAIL) { $env:DEMO_OWNER_EMAIL } else { 'admin@local.dev' }
$firstName = if ($env:DEMO_OWNER_FIRST_NAME) { $env:DEMO_OWNER_FIRST_NAME } else { 'Admin' }
$lastName = if ($env:DEMO_OWNER_LAST_NAME) { $env:DEMO_OWNER_LAST_NAME } else { 'Local' }
$password = if ($env:DEMO_OWNER_PASSWORD) { $env:DEMO_OWNER_PASSWORD } else { 'LocalDev123!' }

$baseUrl = "http://${HostName}:$Port"
$healthUrl = "$baseUrl/healthz"
$settingsUrl = "$baseUrl/rest/settings"
$setupUrl = "$baseUrl/rest/owner/setup"

Write-Host "Waiting for n8n at $baseUrl ..."
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false

while ((Get-Date) -lt $deadline) {
	try {
		$response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 5
		if ($response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ok"') {
			$ready = $true
			break
		}
	} catch {
		# n8n still starting
	}

	Start-Sleep -Seconds 2
}

if (-not $ready) {
	Write-Error "n8n did not become ready within $TimeoutSeconds seconds."
	exit 1
}

$settingsResponse = Invoke-RestMethod -Uri $settingsUrl -Method Get
$showSetup = $settingsResponse.data.userManagement.showSetupOnFirstLoad

if (-not $showSetup) {
	Write-Host "Owner already set up."
	Write-Host "If login fails with 'Wrong username or password', the DB owner is not the demo account."
	Write-Host "Stop n8n, run .\demo\reset-demo-owner.ps1, start n8n again, then re-run this script."
	Write-Host ""
	Write-Host "Otherwise sign in with your existing credentials at $baseUrl"
	exit 0
}

Write-Host "Creating local demo owner ($email) ..."

$body = @{
	email = $email
	firstName = $firstName
	lastName = $lastName
	password = $password
} | ConvertTo-Json

try {
	Invoke-RestMethod -Uri $setupUrl -Method Post -Body $body -ContentType 'application/json' | Out-Null
} catch {
	$message = $_.Exception.Message
	if ($message -match 'Instance owner already setup') {
		Write-Host 'Owner was set up while waiting. You can sign in now.'
		exit 0
	}

	throw
}

Write-Host ""
Write-Host "Owner created successfully."
Write-Host "  URL:      $baseUrl"
Write-Host "  Email:    $email"
Write-Host "  Password: $password"
Write-Host ""
Write-Host "Open $baseUrl — you should see the sign-in page, not owner registration."
