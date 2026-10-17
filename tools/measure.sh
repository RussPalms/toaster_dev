#!/bin/bash
# CPU and memory of a running Toaster over a few seconds.
#   bash tools/measure.sh [seconds]
# Defaults to the development build (npm start / npm run dev). CPU is shown both as a
# share of the whole machine and as "% of one core" (100% = one core fully busy).
seconds="${1:-15}"
case "$seconds" in
  ''|*[!0-9]*) echo "seconds must be a number" >&2; exit 1 ;;
esac

# The Electron binary from source, or a packaged Toaster.app. Match on the command
# path so a second Electron (another app) isn't counted.
root="$(cd "$(dirname "$0")/.." && pwd)"
snapshot() {
  ps -axo pid=,time=,%cpu=,rss=,command= | awk -v root="$root" '
    index($0, root "/node_modules/electron") || index($0, root "/dist/") { print }
  '
}

a="$(snapshot)"
if [[ -z "$a" ]]; then
  echo "No running Toaster found under $root"
  exit 1
fi
sleep "$seconds"
b="$(snapshot)"

cores="$(sysctl -n hw.ncpu)"
awk -v cores="$cores" -v seconds="$seconds" '
  NR == FNR { before[$1] = $2; next }
  {
    n++
    rss += $4
    # ps time is [dd-]hh:mm:ss; take the %cpu column instead, averaged across the wait
    cpu += $3
  }
  END {
    printf "processes         %d\n", n
    printf "cpu %% of 1 core    %.1f\n", cpu
    printf "cpu %% of machine   %.1f\n", (cores > 0 ? cpu / cores : 0)
    printf "memory MB         %.0f\n", rss / 1024
  }
' <(printf '%s\n' "$a") <(printf '%s\n' "$b")
