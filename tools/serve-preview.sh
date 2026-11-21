#!/usr/bin/env bash
# D4 (U20, U21): serve dist/ on a free port, bound to this machine's tailnet address, so a phone
# on the tailnet can open it. Prints the `tailscale serve --https` command for service-worker and
# install checks (those need https). It does NOT run `tailscale serve` (that changes the tailnet
# config); you run the printed command yourself and undo it with `tailscale serve reset`.
#   ./tools/serve-preview.sh [dist-dir] [--local]    (--local binds 127.0.0.1 only)
# Needs: python3 (or python), and a built dist/ (npm run build).
set -euo pipefail
DIST="${1:-dist}"; [ "$DIST" = "--local" ] && DIST=dist
LOCAL=0; for a in "$@"; do [ "$a" = "--local" ] && LOCAL=1; done
[ -f "$DIST/index.html" ] || { echo "No $DIST/index.html: run 'npm run build' first." >&2; exit 1; }
PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] || { echo "python3 not found." >&2; exit 1; }

BIND=127.0.0.1
if [ "$LOCAL" = 0 ]; then
  TS="$(command -v tailscale || true)"
  IP="$([ -n "$TS" ] && "$TS" ip -4 2>/dev/null | head -n1 || true)"
  if [ -n "$IP" ]; then BIND="$IP"; else echo "No tailscale address found: binding 127.0.0.1 only." >&2; fi
fi

PORT=""
for p in $(seq 8700 8799); do
  if ! "$PY" -c "import socket,sys; s=socket.socket(); s.settimeout(0.3); sys.exit(0 if s.connect_ex(('$BIND',$p))==0 else 1)"; then PORT=$p; break; fi
done
[ -n "$PORT" ] || { echo "No free port in 8700-8799." >&2; exit 1; }

echo "Serving $DIST at http://$BIND:$PORT/  (Ctrl+C to stop)"
echo "For https (service worker, Update Now prompt, install), run this yourself in another terminal:"
echo "  tailscale serve --bg --https=8449 http://$BIND:$PORT"
echo "  tailscale serve status     # shows the https URL; check 8449 is free first"
echo "  tailscale serve reset      # when finished (undoes all serve config)"
exec "$PY" -m http.server "$PORT" --bind "$BIND" --directory "$DIST"
