param([int]$Port = 4000)
$pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
if (-not $pids) {
  Write-Host "Port $Port khali hai."
  exit 0
}
foreach ($proc in $pids) {
  Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
  Write-Host "Band kiya: PID $proc (port $Port)"
}
