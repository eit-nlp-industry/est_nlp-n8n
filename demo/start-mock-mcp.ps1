# Start the local robot-dog mock MCP (no gateway).
# Usage (repo root or demo/):
#   .\demo\start-mock-mcp.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$port = if ($env:MOCK_MCP_PORT) { [int]$env:MOCK_MCP_PORT } else { 3921 }
$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
	Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $existing) {
	if ($procId) {
		Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
		Write-Host "Stopped previous listener PID $procId on $port"
	}
}

Write-Host "Starting mock MCP on 127.0.0.1:$port ..."
node .\mock-mcp-server.mjs
