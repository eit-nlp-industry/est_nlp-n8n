# Start production-shaped small-brain MCP adapter (local debug).
# Does NOT replace demo/mock-mcp-server.mjs — that stays for pure mock PoC.
#
# Prerequisites:
#   - Real/small-brain gateway reachable (default http://127.0.0.1:8001)
#   - Or set SMALL_BRAIN_MCP_ALLOW_UNAUTHENTICATED=1 only for isolated MCP bring-up
#
# Usage:
#   powershell -File demo\start-smallbrain-mcp.ps1
#   # then Agent mcpServers URL: http://127.0.0.1:8002/mcp

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not $env:SMALL_BRAIN_MCP_HOST) { $env:SMALL_BRAIN_MCP_HOST = '0.0.0.0' }
if (-not $env:SMALL_BRAIN_MCP_PORT) { $env:SMALL_BRAIN_MCP_PORT = '8002' }
if (-not $env:SMALL_BRAIN_GATEWAY_URL) { $env:SMALL_BRAIN_GATEWAY_URL = 'http://127.0.0.1:8001' }
if (-not $env:MCP_SDK_PACKAGE_JSON) {
	$env:MCP_SDK_PACKAGE_JSON = (Resolve-Path (Join-Path $Root '..\packages\cli\package.json')).Path
}

# Local bring-up defaults: allow no MCP bearer unless you set a token yourself.
if (-not $env:SMALL_BRAIN_MCP_TOKEN -and -not $env:SMALL_BRAIN_TOKEN) {
	$env:SMALL_BRAIN_MCP_ALLOW_UNAUTHENTICATED = '1'
	Write-Host 'SMALL_BRAIN_MCP_ALLOW_UNAUTHENTICATED=1 (no MCP token set; local only)'
}

Write-Host "Starting smallbrain-mcp on port $($env:SMALL_BRAIN_MCP_PORT) ..."
Write-Host "Gateway: $($env:SMALL_BRAIN_GATEWAY_URL)"
Write-Host "MCP URL: http://127.0.0.1:$($env:SMALL_BRAIN_MCP_PORT)/mcp"
node .\smallbrain-mcp-server.mjs
