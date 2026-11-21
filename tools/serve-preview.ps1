# D4 (U20, U21): serve dist\ on a free port, bound to this machine's tailnet address, so a phone
# on the tailnet can open it. Prints the `tailscale serve --https` command for service-worker and
# install checks (those need https). It does NOT run `tailscale serve` (that changes the tailnet
# config); you run the printed command yourself and undo it with `tailscale serve reset`.
#   powershell -File tools\serve-preview.ps1 [-Dist dist] [-Local]    (-Local binds 127.0.0.1 only)
# Needs: python (or py), and a built dist\ (npm run build).
param([string]$Dist = 'dist', [switch]$Local)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $Dist 'index.html'))) { Write-Error "No $Dist\index.html: run 'npm run build' first."; exit 1 }
$py = (Get-Command python3 -ErrorAction SilentlyContinue), (Get-Command python -ErrorAction SilentlyContinue) | Where-Object { $_ } | Select-Object -First 1
if (-not $py) { Write-Error 'python not found.'; exit 1 }

$bind = '127.0.0.1'
if (-not $Local) {
    $ts = Get-Command tailscale -ErrorAction SilentlyContinue
    $ip = $null
    if ($ts) { $ip = (& $ts.Source ip -4 2>$null | Select-Object -First 1) }
    if ($ip) { $bind = $ip.Trim() } else { Write-Warning 'No tailscale address found: binding 127.0.0.1 only.' }
}

$port = $null
foreach ($p in 8700..8799) {
    $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) { $port = $p; break }
}
if (-not $port) { Write-Error 'No free port in 8700-8799.'; exit 1 }

Write-Host "Serving $Dist at http://${bind}:$port/  (Ctrl+C to stop)"
Write-Host 'For https (service worker, Update Now prompt, install), run this yourself in another terminal:'
Write-Host "  tailscale serve --bg --https=8449 http://${bind}:$port"
Write-Host '  tailscale serve status     # shows the https URL; check 8449 is free first'
Write-Host '  tailscale serve reset      # when finished (undoes all serve config)'
& $py.Source -m http.server $port --bind $bind --directory $Dist
