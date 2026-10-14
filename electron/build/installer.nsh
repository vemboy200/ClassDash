; Custom NSIS script, picked up by electron-builder from build/installer.nsh.
;
; customFinishPage replaces electron-builder's own finish page
; (templates/nsis/assistedInstaller.nsh) so it can carry a second
; checkbox: "Delete this installer", on by default. StartApp below is
; that template's own function, copied as is, because defining
; customFinishPage turns the template's version off.
;
; The installer can't delete its own .exe while it's still running, so
; the checkbox starts a hidden cmd.exe that waits for it to exit and then
; deletes it, trying for about 20 seconds. Choosing "all users" makes the
; UAC plugin run a second, elevated copy of the same .exe, and both copies
; have to have exited before the file can go.
;
; The finish page only exists in a normal install. The app's own silent
; update (--updated /S, installReadyUpdate() in main.js) never shows it, so
; it never deletes the update-download.exe the app keeps in the project
; folder.

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function DeleteInstaller
    ExecShell "open" "$SYSDIR\cmd.exe" `/c for /l %i in (1,1,20) do (ping -n 2 127.0.0.1 >nul & del /f /q "$EXEPATH" 2>nul & if not exist "$EXEPATH" exit)` SW_HIDE
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Delete this installer"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "DeleteInstaller"
  !insertmacro MUI_PAGE_FINISH
!macroend
