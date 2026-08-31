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

# ── Code-signing identity ────────────────────────────────────────
#
# Ad-hoc signing (-s -) gives the app a NEW identity every single
# rebuild, since the signature is derived from the binary's own content.
# macOS ties Automation/Files-and-Folders permission grants to that
# identity — so every rebuild looked like a brand new, never-approved
# app, and a permission granted before this rebuild stopped applying
# after it. Confirmed live: the notifier got blocked from launching the
# browser for "check now" right after a rebuild that had already been
# granted permission once.
#
# If a local code-signing certificate named below exists in the
# keychain, it's used instead — same identity every rebuild, so a grant
# survives. Falls back to ad-hoc if it doesn't exist yet, same as before.
# Creating that certificate is a one-time, manual step (Keychain Access
# → Certificate Assistant → Create a Certificate → Code Signing) — not
# something this script creates on its own, since it means asking macOS
# to trust a new identity, and that's a call for a person to make, not
# a build script.
LOCAL_CERT_NAME="SHREK School Software Local"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$LOCAL_CERT_NAME"; then
  CODESIGN_ID="$LOCAL_CERT_NAME"
  echo "Signing with local certificate: $LOCAL_CERT_NAME"
else
  CODESIGN_ID="-"
  echo "No \"$LOCAL_CERT_NAME\" certificate found — signing ad-hoc."
  echo "Automation permissions will need re-granting after every rebuild"
  echo "until one exists. See the README for how to create it."
fi
echo

# ── ClassDash (the summary window AND the notifier) ──
#
# THIS USED TO BE TWO APPS. A second one, invisible (LSUIElement),
# handled the page's buttons via the napominalka:// URL scheme and
# showed the desktop notification popup, built from
# 07-notifier.applescript. Both of those jobs now live directly in
# 16-summary.swift instead:
#
#   - Buttons: the page's own dispatchAction() (08-page.js) hands
#     actions straight to this app through a WKScriptMessageHandler
#     bridge when it's open in this window. When the page is a plain
#     browser tab instead, this app still claims napominalka:// (see
#     CFBundleURLTypes below) and handles it the same way, via the
#     Apple Event handler registered in applicationWillFinishLaunching.
#   - Notifications: `ClassDash --notify` is a distinct,
#     window-less launch mode (see runNotifyMode() in 16-summary.swift)
#     that posts through UserNotifications and exits, instead of a
#     separate always-resident app doing it.
#
# One app, one thing to sign, one permission surface, one place a
# napominalka:// registration can point to instead of two apps
# potentially fighting over the same URL scheme claim.
#
# A real Swift program, WKWebView draws the window. The path gets baked
# into Info.plist under the key "ProjectPath", and that's where
# 16-summary.swift reads it from.
APP_NAME="ClassDash"
if command -v swiftc >/dev/null; then
  echo "→ $APP_NAME"
  mkdir -p "$APP_NAME.app/Contents/MacOS"
  mkdir -p "$APP_NAME.app/Contents/Resources"
  # AppIcon.icns is committed to the repo, not generated at build time —
  # keeps build.sh dependency-free (no image library needed just to
  # copy a file that changes maybe once a year). icon-source.png, the
  # original 32x32 pixel-art export, is kept alongside it for whenever
  # the icon actually needs regenerating — every size in the .icns was
  # produced from that with nearest-neighbor scaling, not smooth
  # resampling, specifically to keep the pixel art crisp instead of
  # blurring it at the larger sizes macOS actually needs (up to 1024x1024).
  cp AppIcon.icns "$APP_NAME.app/Contents/Resources/AppIcon.icns"
  cat > "$APP_NAME.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>$APP_NAME</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleIdentifier</key><string>com.artem.svodka</string>
    <key>CFBundleName</key><string>$APP_NAME</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>ProjectPath</key><string>$PROJ</string>
    <!-- Claims napominalka:// -- the fallback path for when the page is
         opened as a plain browser tab instead of in this window (see
         handleGetURL in 16-summary.swift). The formerly-separate
         notifier app used to register this instead; only one app
         should claim it now. -->
    <key>CFBundleURLTypes</key>
    <array>
      <dict>
        <key>CFBundleURLName</key><string>napominalka</string>
        <key>CFBundleURLSchemes</key>
        <array><string>napominalka</string></array>
      </dict>
    </array>
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
  codesign --force -s "$CODESIGN_ID" "$APP_NAME.app" 2>/dev/null
  echo "  built, path baked into Info.plist"

  # A copy in /Applications: Quick Actions only list programs from there,
  # so that's the only way to bind a keyboard shortcut to the window —
  # and it's where a real installed app is expected to live anyway.
  # Always installed/updated here, not just when a copy already exists.
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$APP_NAME.app" /Applications/
  echo "  installed to /Applications/$APP_NAME.app"

  # macOS needs to be told this app claims napominalka:// -- that
  # doesn't happen on its own until something (Finder, Spotlight)
  # happens to notice it. lsregister forces it immediately, so a
  # napominalka:// link works right after this build finishes instead
  # of only after the app happens to get noticed some other way.
  /System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
    -f "/Applications/$APP_NAME.app" 2>/dev/null
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
  codesign --force --deep -s "$CODESIGN_ID" "Проверить сейчас.app" 2>/dev/null
  echo "  built"
fi

echo
echo "Done."
