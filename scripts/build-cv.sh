#!/usr/bin/env bash
# Build the CV to public/ as a PDF, one per language.
#
#   ./scripts/build-cv.sh             compile every language
#   ./scripts/build-cv.sh nl          compile Dutch only
#   ./scripts/build-cv.sh watch       recompile English on save
#   ./scripts/build-cv.sh watch nl    recompile Dutch on save
#
# One design file (cv/cv.typ), one content file per language (cv/content*.yaml).
# The language is passed to Typst as --input content=…; add a language by adding
# its content file and one line to LANGS below.
#
# Uses `typst` from PATH if present; otherwise downloads a pinned build into
# cv/.bin/ (gitignored). Fonts are vendored in cv/fonts/ and system fonts are
# ignored, so local and CI renders are byte-for-byte identical.

set -euo pipefail

TYPST_VERSION="0.15.1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/cv/cv.typ"
FONTS="$ROOT/cv/fonts"

# lang → content file (relative to cv/, as Typst resolves yaml() from there)
content_for() {
  case "$1" in
    en) echo "content.yaml" ;;
    nl) echo "content.nl.yaml" ;;
    *)  echo "Unknown language: $1 (expected: en, nl)" >&2; exit 1 ;;
  esac
}

# lang → output PDF. English keeps the unsuffixed name it has always had.
out_for() {
  case "$1" in
    en) echo "$ROOT/public/kenneth-breugelmans-cv.pdf" ;;
    *)  echo "$ROOT/public/kenneth-breugelmans-cv-$1.pdf" ;;
  esac
}

LANGS=(en nl)

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
mkdir -p "$ROOT/public"

COMMON=(--font-path "$FONTS" --ignore-system-fonts --root "$ROOT")

if [[ "${1:-}" == "watch" ]]; then
  lang="${2:-en}"
  exec "$TYPST" watch "$SRC" "$(out_for "$lang")" \
    --input "content=$(content_for "$lang")" "${COMMON[@]}"
fi

# A single language, or all of them.
if [[ -n "${1:-}" ]]; then
  LANGS=("$1")
fi

for lang in "${LANGS[@]}"; do
  out="$(out_for "$lang")"
  "$TYPST" compile "$SRC" "$out" --input "content=$(content_for "$lang")" "${COMMON[@]}"
  echo "Built $out"
done
