# Start local n8n with .env.local (Windows / PowerShell)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

pnpm exec -- dotenvx run -f .env.local -- node ./packages/cli/bin/n8n start
