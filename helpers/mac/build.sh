#!/bin/bash
# Compiles the macOS helpers into helpers/mac/bin.
#   bash helpers/mac/build.sh            # this Mac's architecture (npm start)
#   bash helpers/mac/build.sh universal  # Intel and Apple silicon (packaging)
# Bash only builds them. Now Playing and face detection are system frameworks,
# so the helpers themselves are Swift.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p bin

mode="${1:-host}"
minos="13.0"
host="$(uname -m)"
case "$host" in
  arm64|x86_64) ;;
  *) echo "helpers/mac: unexpected architecture $host" >&2; exit 1 ;;
esac

compile_one() {
  local name="$1" arch="$2" out="$3"
  swiftc -O -target "${arch}-apple-macos${minos}" -o "$out" "${name}.swift"
}

compile() {
  local name="$1"
  local src="${name}.swift"
  local out="bin/${name}"
  local stamp="bin/.${name}.built"
  local mark="$mode"
  # A universal binary already runs on this Mac, so a dev start doesn't rebuild it.
  if [[ -x "$out" && "$out" -nt "$src" && -f "$stamp" ]]; then
    local built
    built="$(cat "$stamp")"
    if [[ "$built" == "$mark" || ( "$mark" == "host" && "$built" == "universal" ) ]]; then
      return 0
    fi
  fi
  echo "compiling ${name} (${mode})"
  if [[ "$mode" == "universal" ]]; then
    local x64="bin/${name}-x64" arm="bin/${name}-arm64"
    compile_one "$name" x86_64 "$x64"
    compile_one "$name" arm64 "$arm"
    lipo -create -output "$out" "$x64" "$arm"
    rm -f "$x64" "$arm"
  else
    compile_one "$name" "$host" "$out"
  fi
  chmod +x "$out"
  printf '%s\n' "$mark" > "$stamp"
}

compile nowplaying
compile faces
