# Start local mock MCP for Agent PoC (Streamable HTTP, no auth)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = if ($env:MOCK_MCP_PORT) { $env:MOCK_MCP_PORT } else { '3921' }
$env:MOCK_MCP_PORT = $Port
$env:MOCK_MCP_HOST = if ($env:MOCK_MCP_HOST) { $env:MOCK_MCP_HOST } else { '0.0.0.0' }

Write-Host "Starting mock MCP on port $Port ..."
Set-Location $Root
node .\mock-mcp-server.mjs
