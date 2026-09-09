# n8n local demo helpers (Windows PowerShell)
# Does not modify n8n source. Uses REST APIs against a running instance.

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
	$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$DemoDir = $PSScriptRoot
$DataDir = Join-Path $DemoDir '.n8n-data'
$BaseUrl = if ($env:N8N_BASE_URL) { $env:N8N_BASE_URL.TrimEnd('/') } else { 'http://localhost:5678' }
$Rest = "$BaseUrl/rest"
$BrowserId = 'n8n-demo-bootstrap'
$OwnerEmail = 'demo@example.com'
$OwnerPassword = 'DemoN8n2026!'
$AuthCookie = $null

function Use-Pnpm {
	$filtered = ($env:Path -split ';' | Where-Object { $_ -and ($_ -notmatch '\\AppData\\Local\\pnpm') })
	$env:Path = ($filtered -join ';')
	$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
}

function Invoke-N8nJson {
	param(
		[string]$Method,
		[string]$Url,
		[object]$Body,
		[switch]$AllowError
	)
	$headerArgs = @(
		'-sS', '-D', '-',
		'-X', $Method,
		'-H', "browser-id: $BrowserId",
		'-H', 'Accept: application/json',
		'-H', 'Content-Type: application/json'
	)
	if ($script:AuthCookie) {
		$headerArgs += @('-H', "Cookie: n8n-auth=$script:AuthCookie")
	}
	$bodyFile = $null
	if ($null -ne $Body) {
		$json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 40 -Compress }
		$bodyFile = [System.IO.Path]::GetTempFileName()
		[System.IO.File]::WriteAllText($bodyFile, $json, [System.Text.UTF8Encoding]::new($false))
		$headerArgs += @('--data-binary', "@$bodyFile")
	}
	try {
		$raw = & curl.exe @headerArgs $Url 2>&1 | Out-String
		if ($bodyFile) { Remove-Item -Force $bodyFile -ErrorAction SilentlyContinue }
		$headerEnd = $raw.IndexOf("`r`n`r`n")
		if ($headerEnd -lt 0) { $headerEnd = $raw.IndexOf("`n`n") }
		$head = if ($headerEnd -ge 0) { $raw.Substring(0, $headerEnd) } else { $raw }
		$content = if ($headerEnd -ge 0) { $raw.Substring($headerEnd).Trim() } else { '' }
		if ($head -match 'n8n-auth=([^;]+)') {
			$script:AuthCookie = $Matches[1]
		}
		$status = 0
		if ($head -match 'HTTP/\S+\s+(\d+)') { $status = [int]$Matches[1] }
		if ($status -ge 400) {
			if ($AllowError) { return $null }
			throw "HTTP $status from $Method $Url : $content"
		}
		if ([string]::IsNullOrWhiteSpace($content)) { return $null }
		return ($content | ConvertFrom-Json)
	} catch {
		if ($bodyFile -and (Test-Path $bodyFile)) { Remove-Item -Force $bodyFile -ErrorAction SilentlyContinue }
		if ($AllowError) { return $null }
		throw
	}
}

function Get-Payload {
	param($Response)
	if ($null -eq $Response) { return $null }
	if ($Response.PSObject.Properties.Name -contains 'data') { return $Response.data }
	return $Response
}

function Wait-N8n {
	param([int]$Seconds = 180)
	$deadline = (Get-Date).AddSeconds($Seconds)
	while ((Get-Date) -lt $deadline) {
		try {
			$r = Invoke-WebRequest -Uri "$BaseUrl/healthz/readiness" -Method GET -TimeoutSec 5 -UseBasicParsing
			if ($r.StatusCode -eq 200) { return $true }
		} catch {}
		Start-Sleep -Seconds 2
	}
	throw "n8n did not become ready at $BaseUrl/healthz/readiness within ${Seconds}s"
}

function Initialize-Owner {
	$setup = Invoke-N8nJson -Method POST -Url "$Rest/owner/setup" -AllowError -Body @{
		email     = $OwnerEmail
		firstName = 'Demo'
		lastName  = 'Owner'
		password  = $OwnerPassword
	}
	if ($null -eq $setup) {
		Invoke-N8nJson -Method POST -Url "$Rest/login" -Body @{
			emailOrLdapLoginId = $OwnerEmail
			password           = $OwnerPassword
		} | Out-Null
	}
	if (-not $script:AuthCookie) {
		throw 'Failed to obtain n8n-auth cookie. Check owner setup/login.'
	}
}

function Import-DemoWorkflow {
	param([string]$Path)
	$rawJson = Get-Content -Raw -Path $Path
	$created = Get-Payload (Invoke-N8nJson -Method POST -Url "$Rest/workflows" -Body $rawJson)
	if (-not $created -or -not $created.id) {
		throw "Failed to import workflow from $Path"
	}
	return $created
}

function Update-DemoWorkflow {
	param($Workflow)
	$body = @{
		name        = $Workflow.name
		nodes       = $Workflow.nodes
		connections = $Workflow.connections
		settings    = $Workflow.settings
		versionId   = $Workflow.versionId
	}
	return Get-Payload (Invoke-N8nJson -Method PATCH -Url "$Rest/workflows/$($Workflow.id)" -Body $body)
}

function Activate-DemoWorkflow {
	param($Workflow)
	Invoke-N8nJson -Method POST -Url "$Rest/workflows/$($Workflow.id)/activate" -Body @{
		versionId = $Workflow.versionId
		name      = $Workflow.name
	} | Out-Null
}
