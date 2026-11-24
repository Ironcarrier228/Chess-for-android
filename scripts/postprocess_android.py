#!/usr/bin/env python3
"""Правки index.html для запуска внутри Android WebView (file://)."""
import sys

path = sys.argv[1]
html = open(path, encoding="utf-8").read()

# Манифест PWA внутри APK не нужен
html = html.replace('<link rel="manifest" href="manifest.webmanifest" />', "")

# Service worker на file:// недоступен — оставляем код, но не запускаем
html = html.replace(
    'if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {',
    'if (false) { // service worker не работает на file://',
)

open(path, "w", encoding="utf-8").write(html)
print("postprocess: готово ->", path)
