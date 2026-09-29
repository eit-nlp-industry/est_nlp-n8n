# Stop processes listening on a TCP port (use when an old Vite/node is stuck).
param(
	[int]$Port = 8080,
	[switch]$Force
)

$ErrorActionPreference = 'Stop'

$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $connections) {
	Write-Host "No listener on port $Port."
	exit 0
}

$pids = $connections.OwningProcess | Sort-Object -Unique
foreach ($pid in $pids) {
	$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
	$name = if ($proc) { $proc.ProcessName } else { 'unknown' }
	Write-Host "Port $Port -> PID $pid ($name)"
	if ($name -match 'docker|wslrelay') {
		Write-Host "  Skipping Docker/WSL relay. Use demo/start-fe-editor.ps1 to pick another port."
		continue
	}
	if ($Force) {
		Stop-Process -Id $pid -Force
		Write-Host "  Stopped."
	} else {
		Write-Host "  Re-run with -Force to stop, or use start-fe-editor.ps1 on another port."
	}
}
