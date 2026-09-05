# Start all containers and set up the project
param(
    [switch]$Seed = $false
)

$ErrorActionPreference = 'Stop'

Write-Host "Starting Docker containers..." -ForegroundColor Cyan

# Check if Docker is available
try {
    docker version | Out-Null
} catch {
    Write-Host "[ERROR] Docker is not available. Please install Docker Desktop or Docker CLI." -ForegroundColor Red
    exit 1
}

# Check if .env exists, if not copy from .env.example
if (-not (Test-Path '.env')) {
    if (Test-Path '.env.example') {
        Write-Host "Creating .env from .env.example..." -ForegroundColor Yellow
        Copy-Item '.env.example' '.env'
    } else {
        Write-Host "[WARN] No .env or .env.example found. Proceeding with defaults..." -ForegroundColor Yellow
    }
}

# Start containers
Write-Host "Running docker compose up -d..." -ForegroundColor Cyan
docker compose up -d
$composeResult = $?

if (-not $composeResult) {
    Write-Host "[ERROR] Docker compose failed." -ForegroundColor Red
    exit 1
}

Write-Host "Waiting for postgres to be ready..." -ForegroundColor Yellow
$attempts = 0
$maxAttempts = 30
while ($attempts -lt $maxAttempts) {
    try {
        $result = docker compose exec -T postgres pg_isready -U postgres -d store 2>&1
        if ($result -match "accepting connections") {
            Write-Host "PostgreSQL is ready!" -ForegroundColor Green
            break
        }
    } catch {
        # Retry
    }
    Start-Sleep -Seconds 1
    $attempts++
}

if ($attempts -eq $maxAttempts) {
    Write-Host "[WARN] PostgreSQL did not respond after $maxAttempts seconds, but proceeding..." -ForegroundColor Yellow
}

Write-Host "Waiting for API to be ready..." -ForegroundColor Yellow
$attempts = 0
$maxApiAttempts = 20
$apiReady = $false
while ($attempts -lt $maxApiAttempts) {
    try {
        # -o NUL, not /dev/null: on Windows curl resolves /dev/null to C:\dev\null, fails with
        # exit 23 and never yields a status code, so the loop could never succeed.
        # --max-time is required: without it a container that accepts TCP but never answers makes
        # curl block forever, the loop never advances and the fatal check below is never reached.
        $result = curl.exe -s --max-time 2 -o NUL -w "%{http_code}" http://localhost:3000/health
        if ($result -eq "200") {
            Write-Host "API is ready!" -ForegroundColor Green
            $apiReady = $true
            break
        }
    } catch {
        # Retry
    }
    Start-Sleep -Seconds 1
    $attempts++
}

if (-not $apiReady) {
    Write-Host "[ERROR] API did not answer /health after $maxApiAttempts attempts." -ForegroundColor Red
    Write-Host "        Logs: docker compose logs api" -ForegroundColor Red
    exit 1
}

Write-Host "Waiting for migrations to complete in api container..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

if ($Seed) {
    Write-Host "Seeding catalog..." -ForegroundColor Cyan
    npm run seed:catalog
    if (-not $?) {
        Write-Host "[ERROR] Seeding failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "Catalog seeded!" -ForegroundColor Green
}

Write-Host ""
Write-Host "All containers are running!" -ForegroundColor Green
Write-Host ""
Write-Host "Service endpoints:" -ForegroundColor Cyan
Write-Host "   API:        http://localhost:3000" -ForegroundColor White
Write-Host "   Supplier A: http://localhost:4001" -ForegroundColor White
Write-Host "   Supplier B: http://localhost:4002" -ForegroundColor White
Write-Host "   Database:   localhost:5432" -ForegroundColor White
Write-Host ""
Write-Host "Quick checks:" -ForegroundColor Cyan
Write-Host "   curl -i http://localhost:3000/health" -ForegroundColor Gray
Write-Host "   curl -s http://localhost:3000/catalog | head -c 300" -ForegroundColor Gray
Write-Host "   npm run race -- --sku KEY-GTA5 --count 50" -ForegroundColor Gray
Write-Host ""
Write-Host "To stop: docker compose down" -ForegroundColor Yellow
Write-Host ""
Write-Host "To seed catalog: npm run seed:catalog" -ForegroundColor Green
