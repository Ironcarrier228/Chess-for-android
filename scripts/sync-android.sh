#!/usr/bin/env bash
# Копирует веб-приложение в Android-проект (assets/www).
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="android/app/src/main/assets/www"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r index.html manifest.webmanifest sw.js src vendor assets "$DEST"/

# На file:// манифест и service worker не работают — отключаем их в копии.
python3 scripts/postprocess_android.py "$DEST/index.html"

echo "Готово: $DEST"
du -sh "$DEST"
