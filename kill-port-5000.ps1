Write-Host "Finding process on port 5000..." -ForegroundColor Yellow

$process = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1

if ($process) {
    Write-Host "Killing process $process on port 5000" -ForegroundColor Red
    Stop-Process -Id $process -Force
    Write-Host "Process killed successfully!" -ForegroundColor Green
    Start-Sleep -Seconds 1
} else {
    Write-Host "No process found on port 5000" -ForegroundColor Yellow
}
