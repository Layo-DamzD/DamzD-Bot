#!/bin/bash
# Check which npm Baileys forks contain the companion_reg_refresh pairing fix
cd /tmp && rm -rf forkcheck && mkdir forkcheck && cd forkcheck

for p in "@kelvdra/baileys" "raiden-baileys" "kage-baileys" "@itsliaaa/baileys" "@rexxhayanasi/elaina-baileys"; do
  d=$(echo "$p" | sed 's/@//g; s/\//-/g')
  f=$(npm pack "$p" --silent 2>/dev/null | tail -1)
  if [ -z "$f" ]; then echo "=== $p : PACK FAILED ==="; continue; fi
  mkdir -p "$d" && tar -xzf "$f" -C "$d" 2>/dev/null
  echo "=== $p -> $f ==="
  hits=$(rg -l "companion_reg_refresh" "$d" 2>/dev/null | head -3)
  if [ -n "$hits" ]; then echo "  FIX PRESENT:"; echo "$hits" | sed 's/^/    /'; else echo "  NO companion_reg_refresh fix"; fi
  python3 - "$d" <<'EOF'
import json, sys, glob, os
d = sys.argv[1]
pkg = json.load(open(os.path.join(d, "package.json")))
print("  pkg name:", pkg.get("name"), "| version:", pkg.get("version"))
main = pkg.get("main") or ""
print("  main:", main, "| exists:", os.path.exists(os.path.join(d, main)))
EOF
done
