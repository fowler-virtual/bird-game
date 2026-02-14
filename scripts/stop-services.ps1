# Stop processes using claim/dev/chain ports (Windows PowerShell)
# Usage: .\scripts\stop-services.ps1

$ports = @(8545, 3001, 5173, 5174)
foreach ($port in $ports) {
  $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if ($conn) {
    $pid = $conn.OwningProcess | Select-Object -First 1
    Write-Host "Stopping process $pid on port $port"
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}
