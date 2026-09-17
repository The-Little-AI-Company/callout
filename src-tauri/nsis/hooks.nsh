; Tauri NSIS hooks. Close a running Callout before installing or uninstalling,
; otherwise the old build keeps sitting in the tray next to the new one.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM callout.exe'
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM callout.exe'
  Sleep 500
!macroend
