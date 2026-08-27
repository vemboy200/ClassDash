#!/bin/bash
#
# Builds both of the project's apps and bakes the project path into them.
#
# ── Why this script exists at all ──
#
# The apps need to know where the project lives, and they can't figure
# that out on their own: the "Summary" copy lives in /Applications, far
# from the folder. The path used to just be hardcoded into the source —
# and along with it, someone's home folder and username would have ended
# up in the repository.
#
# Now the path is computed HERE, from this script's own location, and
# baked in at build time. It never appears in the source.
#
# ── Running it ──
#     ./build.sh
#
# Needs rerunning after every edit to a .applescript or .swift file:
# editing the source alone changes nothing until the app is rebuilt.
# This has already caused confusion twice.
#
# Variables are named in LATIN on purpose: the shell doesn't accept
# Cyrillic names at all, and reads a line like `ИМЯ=значение` as an
# attempt to run a program by that name. Same as AppleScript. Caught the
# very first time this script ran.

set -e
PROJ="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJ"
TMPDIR_="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_"' EXIT

echo "Project: $PROJ"
echo

# ── Notifier ──────────────────────────────────────────────────
#
# Doesn't need the path: it lives inside the folder and finds it itself
# via `path to me`.
#
# Built into a temp location and only the compiled script gets copied in.
# Building directly on top would wipe out Info.plist, where three things
# have accumulated, each one fixing a separate break: its own identifier
# (otherwise there's no entry in Notification settings), the napominalka://
# link type (otherwise the buttons on the page don't work), and
# LSUIElement (otherwise the window switches you to a different desktop).
if [ -d "Напоминалка.app" ] && [ -f 07-напоминалка.applescript ]; then
  echo "→ Notifier"
  osacompile -o "$TMPDIR_/Напоминалка.app" 07-напоминалка.applescript
  cp "$TMPDIR_/Напоминалка.app/Contents/Resources/Scripts/main.scpt" \
     "Напоминалка.app/Contents/Resources/Scripts/main.scpt"
  codesign --force --deep -s - "Напоминалка.app" 2>/dev/null
  echo "  built, Info.plist untouched"
else
  echo "→ Notifier skipped (no .app or source found)"
fi

# ── SHREK School Software (the summary window) ──────────────────
#
# A real Swift program, WKWebView draws the window. The path gets baked
# into Info.plist under the key "ProjectPath", and that's where
# 16-summary.swift reads it from.
APP_NAME="SHREK School Software"
if command -v swiftc >/dev/null; then
  echo "→ $APP_NAME"
  mkdir -p "$APP_NAME.app/Contents/MacOS"
  cat > "$APP_NAME.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>$APP_NAME</string>
    <key>CFBundleIdentifier</key><string>com.artem.svodka</string>
    <key>CFBundleName</key><string>$APP_NAME</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>ProjectPath</key><string>$PROJ</string>
</dict>
</plist>
PLIST
  # -target pins the deployment target explicitly: some Swift toolchains
  # default the binary's minimum-OS requirement to whatever future macOS
  # the SDK itself targets (seen defaulting to "28.0" on a toolchain
  # running under macOS 27), which makes Launch Services flat-out refuse
  # to open the app on anything older than that — a launch failure with
  # no useful error, only visible via `otool -l` on the built binary.
  # MACOSX_DEPLOYMENT_TARGET alone did not override this; -target does.
  # 11.0 covers everything this app actually uses (NSWindow, WKWebView).
  # $(uname -m) keeps this working on both Apple Silicon and Intel.
  swiftc -O -target "$(uname -m)-apple-macos11" -o "$APP_NAME.app/Contents/MacOS/$APP_NAME" 16-summary.swift
  codesign --force -s - "$APP_NAME.app" 2>/dev/null
  echo "  built, path baked into Info.plist"

  # A copy in /Applications: Quick Actions only list programs from there,
  # so that's the only way to bind a keyboard shortcut to the window —
  # and it's where a real installed app is expected to live anyway.
  # Always installed/updated here, not just when a copy already exists.
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$APP_NAME.app" /Applications/
  echo "  installed to /Applications/$APP_NAME.app"
else
  echo "→ swiftc not found, skipping $APP_NAME (needs developer tools)"
fi

# ── Check now ─────────────────────────────────────────────────
#
# This app was removed on August 14th: manual triggering moved to a long
# press on the "reload" button. The source is kept around, so it's only
# built if the app still exists.
if [ -d "Проверить сейчас.app" ] && [ -f 09-проверить-сейчас.applescript ]; then
  echo "→ Check now"
  # The placeholder is named ПУТЬ_ПРОЕКТА — exactly as it is in the source.
  #
  # There used to be a typo here, "ПУТЬ_PROJА": a bulk replace of "ПРОЕКТ"
  # with "PROJ" (shell variables have to be Latin) reached into the middle
  # of this word too. The result was a mix of Latin and Cyrillic letters,
  # indistinguishable by eye, and the substitution silently failed to
  # match. It never misfired only because this whole branch only runs
  # when the app already exists.
  sed "s|ПУТЬ_ПРОЕКТА|$PROJ|" 09-проверить-сейчас.applescript > "$TMPDIR_/check.applescript"
  osacompile -o "$TMPDIR_/Проверить сейчас.app" "$TMPDIR_/check.applescript"
  cp "$TMPDIR_/Проверить сейчас.app/Contents/Resources/Scripts/main.scpt" \
     "Проверить сейчас.app/Contents/Resources/Scripts/main.scpt"
  codesign --force --deep -s - "Проверить сейчас.app" 2>/dev/null
  echo "  built"
fi

echo
echo "Done."
