<#
.SYNOPSIS
    Runs the k6 load-test matrix: cached vs uncached redirects x 1 vs 3 app replicas.

.DESCRIPTION
    For each replica count the script boots the Docker Compose stack (with
    rate limiting disabled via load/docker-compose.load.yml), issues an API
    key, runs one k6 invocation per scenario, and writes a results JSON per
    run into load/results/. A summary table (RPS / p95 / p99) is printed at
    the end.

    Replicas scale 1 -> 3 (never down) so nginx's 10s DNS re-resolution
    only ever discovers new instances.

.PARAMETER Vus
    Virtual users per scenario (default 50).

.PARAMETER DurationSeconds
    Wall time per k6 run (default 30).

.PARAMETER BaseUrl
    Public entry point (nginx), default http://localhost:8080.

.EXAMPLE
    ./load/run-matrix.ps1 -Vus 50 -DurationSeconds 30

.NOTES
    Requires k6 (https://k6.io) and Docker Compose in PATH. Leaves the
    stack scaled to 3 replicas with rate limiting disabled - restart it
    normally afterwards:
        docker compose up -d --build --scale app=1
#>
param(
    [int]$Vus = 50,
    [int]$DurationSeconds = 30,
    [string]$BaseUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$resultsDir = Join-Path $PSScriptRoot "results"

Push-Location $repoRoot
try {
    Remove-Item -Recurse -Force $resultsDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

    # Scale up in order: nginx re-resolves new replicas via its 10s DNS TTL.
    foreach ($replicas in 1, 3) {
        Write-Host "==> Building stack and scaling app to $replicas replica(s) (rate limiting off)..." -ForegroundColor Cyan
        docker compose -f docker-compose.yml -f load/docker-compose.load.yml up -d --build --scale app=$replicas
        if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

        Write-Host "Waiting for nginx DNS re-resolution and health checks..."
        Start-Sleep -Seconds 25

        $key = (Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/keys").apiKey

        foreach ($scenario in "cached", "uncached") {
            $out = Join-Path $resultsDir "r$replicas-$scenario.json"
            Write-Host "==> k6 $scenario x $replicas replica(s) -> $out" -ForegroundColor Cyan

            $env:SCENARIO = $scenario
            $env:BASE_URL = $BaseUrl
            $env:API_KEY = $key
            $env:VUS = "$Vus"
            $env:DURATION = "${DurationSeconds}s"
            $env:REPLICAS = "$replicas"
            $env:RESULTS_JSON = $out

            k6 run -q load/k6/redirect-test.js
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "k6 exited with $LASTEXITCODE for $scenario x $replicas; results may be incomplete."
            }
        }

        Remove-Item Env:SCENARIO, Env:API_KEY, Env:REPLICAS, Env:RESULTS_JSON -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "=== Load test matrix (RPS / p95 / p99 in ms) ===" -ForegroundColor Green
    Get-ChildItem $resultsDir -Filter "r*.json" | ForEach-Object {
        $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
        [PSCustomObject]@{
            Replicas = $j.replicas
            Scenario = $j.scenario
            RPS      = [math]::Round($j.rps, 1)
            P50      = [math]::Round($j.p50Ms, 1)
            P95      = [math]::Round($j.p95Ms, 1)
            P99      = [math]::Round($j.p99Ms, 1)
        }
    } | Sort-Object Replicas, Scenario | Format-Table -AutoSize

    Write-Host "Results JSON files are in load/results/." -ForegroundColor Yellow
    Write-Host "NOTE: the stack is left scaled to 3 replicas with rate limiting disabled." -ForegroundColor Yellow
    Write-Host "Restore normal operation with: docker compose up -d --build --scale app=1" -ForegroundColor Yellow
}
finally {
    Pop-Location
}
