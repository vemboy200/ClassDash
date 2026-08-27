-- The notifier: the small always-running piece that makes the page's
-- buttons actually do something, and that shows the popup.
--
-- Two separate jobs, two separate entry points into this same app:
--
--   1. Launched DIRECTLY (05-playwright-draft.js's notify() runs
--      Contents/MacOS/applet by hand) -> `run`. Reads уведомление.txt
--      (title/subtitle/message, one per line) and shows a real
--      notification under this app's own name — not "Script Editor",
--      which is what a bare `osascript -e 'display notification ...'`
--      shows up as.
--
--   2. Opened via a napominalka:// link on the page -> `open location`.
--      That's how macOS delivers a custom URL scheme to whichever app
--      registered it (see the CFBundleURLTypes entry build.sh writes
--      into this app's Info.plist).
--
-- All the actual work for #2 — writing to не-срочно.txt/скрытые.txt,
-- applying settings, redrawing the page, kicking off a full check — is
-- deliberately NOT written here. It lives in 21-notifier-actions.js,
-- because that's testable by just running it with node, while an
-- AppleScript app can only really be tested by rebuilding and relaunching
-- it. This file's only job is parsing the URL and handing off to that.

on run
	try
		my showNotification()
	on error errMsg number errNum
		my logLine("run failed: " & errNum & " — " & errMsg)
	end try
end run

on open location theURL
	my logLine("open location: " & theURL)
	try
		my dispatch(theURL)
		my logLine("  dispatch ok")
	on error errMsg number errNum
		my logLine("  dispatch FAILED: " & errNum & " — " & errMsg)
	end try
end open location

-- WHY THIS EXISTS: THE BARE `try` ABOVE USED TO HAVE NO `on error`.
--
-- An AppleScript `try` with no error branch discards the error entirely.
-- Both handlers here had one, so every possible failure in this app —
-- including the one that actually happened — produced exactly nothing:
-- no popup, no message, no trace. macOS reported the URL as delivered,
-- the page looked fine, and the button simply did nothing. Three
-- separate fixes were made elsewhere in the chain before anyone could
-- see that the failure was in here.
--
-- Written with AppleScript's own file commands rather than
-- `do shell script`, deliberately: the failure being recorded is a
-- `do shell script` that couldn't run, so using one to report it would
-- fail in exactly the same silence.
on logLine(theText)
	try
		set logPath to my getProjectDir() & "notifier-log.txt"
		-- `current date`, not a `date` call through the shell: the whole
		-- point is to still work when the shell is the broken part.
		set stamp to ((current date) as string)
		set fileRef to open for access (POSIX file logPath) with write permission
		write (stamp & "  [app] " & theText & linefeed) to fileRef starting at eof
		close access fileRef
	on error
		-- Last resort: if even that failed, try to leave the file closed
		-- rather than locked open for the next launch.
		try
			close access (POSIX file (my getProjectDir() & "notifier-log.txt"))
		end try
	end try
end logLine

on getProjectDir()
	-- The app lives directly inside the project folder — same as how
	-- 16-summary.swift finds its own project folder, and for the same
	-- reason: no absolute path is baked in anywhere, so this can't leak
	-- someone's home folder into the repository.
	set appPosix to POSIX path of (path to me)
	if appPosix ends with "/" then set appPosix to text 1 thru -2 of appPosix
	set AppleScript's text item delimiters to "/"
	set pathParts to text items of appPosix
	set pathParts to items 1 thru -2 of pathParts
	set projectDir to (pathParts as text) & "/"
	set AppleScript's text item delimiters to ""
	return projectDir
end getProjectDir

on showNotification()
	set projectDir to my getProjectDir()
	set notifyFile to projectDir & "уведомление.txt"

	try
		set fileContent to (read POSIX file notifyFile as «class utf8»)
	on error
		return -- nothing waiting to be shown, and that's normal
	end try

	set AppleScript's text item delimiters to linefeed
	set fileLines to text items of fileContent
	set AppleScript's text item delimiters to ""

	set theTitle to item 1 of fileLines
	set theSubtitle to ""
	set theMessage to ""
	if (count of fileLines) > 1 then set theSubtitle to item 2 of fileLines
	if (count of fileLines) > 2 then set theMessage to item 3 of fileLines

	-- Deleted right after reading — see the comment on NOTIFY_FILE in
	-- 05-playwright-draft.js for why.
	try
		do shell script "rm " & quoted form of notifyFile
	end try

	display notification theMessage with title theTitle subtitle theSubtitle sound name "Glass"
end showNotification

on dispatch(theURL)
	-- theURL looks like napominalka://ACTION or napominalka://ACTION/ARG.
	-- Splitting on "/" is safe for the argument too: ids arrive
	-- percent-encoded (a real "/" would already be "%2F"), and the
	-- "config" argument is base64url, which never contains a raw "/"
	-- either — that's exactly why base64url exists instead of base64.
	set AppleScript's text item delimiters to "://"
	set afterScheme to text item 2 of theURL
	set AppleScript's text item delimiters to "/"
	set urlParts to text items of afterScheme
	set AppleScript's text item delimiters to ""

	set actionName to item 1 of urlParts
	set theArg to ""
	if (count of urlParts) > 1 then set theArg to item 2 of urlParts

	set projectDir to my getProjectDir()
	set actionsScript to projectDir & "21-notifier-actions.js"

	-- PATH HAS TO BE SET HERE, AND THIS IS THE WHOLE BUG.
	--
	-- `do shell script` does NOT get the PATH from a login shell. When
	-- this app is launched by macOS from a napominalka:// URL, it gets a
	-- minimal environment — roughly /usr/bin:/bin:/usr/sbin:/sbin — and
	-- Homebrew's node lives in /opt/homebrew/bin, which is not in it. So
	-- the command failed with "node: command not found" on every single
	-- click, and the bare `try` in `open location` swallowed it whole.
	--
	-- The result was a button that did nothing, with every other part of
	-- the chain provably healthy: the page built the URL correctly,
	-- macOS accepted and delivered it, the app launched, and the action
	-- script it was supposed to run was never reached. Testing that
	-- script by hand always worked, because a terminal has a real PATH.
	--
	-- Both Homebrew locations are covered (/opt/homebrew on Apple
	-- silicon, /usr/local on Intel), and the inherited PATH is kept
	-- after them so a node installed anywhere else still wins if those
	-- two come up empty. Prepending rather than hardcoding one absolute
	-- path also survives a node upgrade moving the binary.
	set pathPrefix to "export PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"; "
	do shell script pathPrefix & "node " & quoted form of actionsScript & " " & quoted form of actionName & " " & quoted form of theArg
end dispatch
