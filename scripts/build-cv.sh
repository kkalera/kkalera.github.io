#!/usr/bin/env bash
# Build the CV to public/ as a PDF.
#
#   ./scripts/build-cv.sh          compile once
#   ./scripts/build-cv.sh watch    recompile on save (pairs well with a PDF viewer)
#
# Uses `typst` from PATH if present; otherwise downloads a pinned build into
# cv/.bin/ (gitignored). Fonts are vendored in cv/fonts/ and system fonts are
# ignored, so local and CI renders are byte-for-byte identical.

set -euo pipefail

TYPST_VERSION="0.15.1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/cv/cv.typ"
FONTS="$ROOT/cv/fonts"
OUT="$ROOT/public/kenneth-breugelmans-cv.pdf"

resolve_typst() {
  if command -v typst >/dev/null 2>&1; then
    command -v typst
    return
  fi

  local bin="$ROOT/cv/.bin/typst"
  if [[ -x "$bin" ]]; then
    echo "$bin"
    return
  fi

  local target
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)   target="x86_64-unknown-linux-musl" ;;
    Linux-aarch64)  target="aarch64-unknown-linux-musl" ;;
    Darwin-x86_64)  target="x86_64-apple-darwin" ;;
    Darwin-arm64)   target="aarch64-apple-darwin" ;;
    *)
      echo "No prebuilt Typst for $(uname -s)-$(uname -m). Install it manually: https://github.com/typst/typst" >&2
      exit 1
      ;;
  esac

  echo "Downloading Typst ${TYPST_VERSION} (${target})…" >&2
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -sSfL \
    "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${target}.tar.xz" \
    -o "$tmp/typst.tar.xz"
  tar -xf "$tmp/typst.tar.xz" -C "$tmp"
  mkdir -p "$ROOT/cv/.bin"
  mv "$tmp/typst-${target}/typst" "$bin"
  chmod +x "$bin"
  echo "$bin"
}

TYPST="$(resolve_typst)"
mkdir -p "$(dirname "$OUT")"

COMMON=(--font-path "$FONTS" --ignore-system-fonts --root "$ROOT")

if [[ "${1:-}" == "watch" ]]; then
  exec "$TYPST" watch "$SRC" "$OUT" "${COMMON[@]}"
fi

"$TYPST" compile "$SRC" "$OUT" "${COMMON[@]}"
echo "Built $OUT"
