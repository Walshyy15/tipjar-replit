# How to Fix "Port Already in Use" Error

## The Error
```
Error: listen EADDRINUSE: address already in use 0.0.0.0:5000
```

This means another process is already running on port 5000.

## Solution 1: Find and Kill the Process (Windows)

### Step 1: Find what's using port 5000
```powershell
netstat -ano | findstr :5000
```

This will show output like:
```
TCP    0.0.0.0:5000    0.0.0.0:0    LISTENING    12345
```

The last number (12345 in this example) is the Process ID (PID).

### Step 2: Kill the process
```powershell
taskkill /F /PID 12345
```

Replace `12345` with the actual PID from step 1.

## Solution 2: Use a Different Port

If you want to run on a different port, edit `server/index.ts` and change:

```typescript
const PORT = process.env.PORT || 5000;
```

to:

```typescript
const PORT = process.env.PORT || 3000;  // or any other available port
```

## Solution 3: Quick Kill Script

Create a file called `kill-port-5000.ps1`:

```powershell
Write-Host "Finding process on port 5000..." -ForegroundColor Yellow

$process = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1

if ($process) {
    Write-Host "Killing process $process" -ForegroundColor Red
    Stop-Process -Id $process -Force
    Write-Host "Process killed successfully!" -ForegroundColor Green
} else {
    Write-Host "No process found on port 5000" -ForegroundColor Yellow
}
```

Run it before starting your server:
```powershell
.\kill-port-5000.ps1
npm run dev
```

## Best Practice

**Only run ONE instance of your server at a time!**

Choose either:
- `npm run dev` (for development - recommended)
- `.\run-local.ps1` (full build + start)

Don't run both at once!
