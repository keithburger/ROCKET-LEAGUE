#!/usr/bin/env bash
# Builds the compact 4-file distribution (index.html, style.css, game.js, rapier.js) and zips it.
#  - three.js is tree-shaken and everything is minified with esbuild
#  - Rapier's embedded WASM is gzip-compressed and inflated in the browser (DecompressionStream)
# Requires: node, python3, zip, and the unminified three.module.js 0.160.1 (fetched from npm if missing).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/afterburn-arena-small.zip}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
ESBUILD="npx --yes esbuild@0.28.2"
mkdir -p "$WORK/proj/vendor" "$WORK/site"
cp -r "$ROOT/src" "$WORK/proj/"
( cd "$WORK" && npm pack --silent three@0.160.1 >/dev/null && tar xzf three-0.160.1.tgz && cp package/build/three.module.js proj/vendor/three.module.js )
sed -i 's#vendor/three.module.min.js#vendor/three.module.js#' "$WORK"/proj/src/*.js
python3 - "$ROOT/vendor/rapier.es.js" "$WORK/proj/vendor/rapier.es.js" <<'PY'
import re, sys, base64, gzip
s = open(sys.argv[1]).read()
m = re.search(r'fI\.toByteArray\("(AGFzbQ[A-Za-z0-9+/=]{1000,})"\)\.buffer', s)
gz = base64.b64encode(gzip.compress(base64.b64decode(m.group(1)), 9)).decode()
s = s.replace(m.group(0), '(yield __rgz("' + gz + '"))')
pre = ('async function __rgz(b){const bin=atob(b),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);'
       'return await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()}\n')
open(sys.argv[2], 'w').write(pre + s)
PY
$ESBUILD "$WORK/proj/src/main.js" --bundle --minify --format=esm --target=es2020 --external:../vendor/rapier.es.js --outfile="$WORK/site/game.js" --log-level=warning
sed -i 's#\.\./vendor/rapier\.es\.js#./rapier.js#g' "$WORK/site/game.js"
$ESBUILD "$WORK/proj/vendor/rapier.es.js" --minify --format=esm --outfile="$WORK/site/rapier.js" --log-level=warning
sed -e '/<script type="importmap">/,/<\/script>/d' -e 's#src/main.js#game.js#' "$ROOT/index.html" > "$WORK/site/index.html"
cp "$ROOT/style.css" "$WORK/site/"
rm -f "$OUT"; ( cd "$WORK/site" && zip -9 -q "$OUT" index.html style.css game.js rapier.js )
ls -l "$WORK/site" "$OUT"
