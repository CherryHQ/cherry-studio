;Inspired by:
; https://gist.github.com/bogdibota/062919938e1ed388b3db5ea31f52955c
; https://stackoverflow.com/questions/34177547/detect-if-visual-c-redistributable-for-visual-studio-2013-is-installed
; https://stackoverflow.com/a/54391388
; https://github.com/GitCommons/cpp-redist-nsis/blob/main/installer.nsh

;Find latests downloads here:
; https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist

!include LogicLib.nsh
!include x64.nsh
!include FileFunc.nsh

; https://github.com/electron-userland/electron-builder/issues/1122
!ifndef BUILD_UNINSTALLER
  ; Holds the $INSTDIR value that the electron-builder template creates with
  ; `SetOutPath $INSTDIR` at the top of `.onInit`, before `initMultiUser` may
  ; rewrite $INSTDIR. Saved in `preInit` so the abort path cleans up only the
  ; directory the template created, never the final user-selected directory
  ; (which may pre-exist empty and must not be deleted by this check).
  Var osSupportInitialInstDir

  ; Check VC++ Redistributable based on architecture stored in $1
  Function checkVCRedist
    ${If} $1 == "arm64"
      ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\ARM64" "Installed"
    ${Else}
      ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ${EndIf}
  FunctionEnd

  Function checkArchitectureCompatibility
    ; Initialize variables
    StrCpy $0 "0"  ; Default to incompatible
    StrCpy $1 ""   ; System architecture
    StrCpy $3 ""   ; App architecture

    ; Check system architecture using built-in NSIS functions
    ${If} ${RunningX64}
      ; Check if it's ARM64 by looking at processor architecture
      ReadEnvStr $2 "PROCESSOR_ARCHITECTURE"
      ReadEnvStr $4 "PROCESSOR_ARCHITEW6432"

      ${If} $2 == "ARM64"
      ${OrIf} $4 == "ARM64"
        StrCpy $1 "arm64"
      ${Else}
        StrCpy $1 "x64"
      ${EndIf}
    ${Else}
      StrCpy $1 "x86"
    ${EndIf}

    ; Determine app architecture based on build variables
    !ifdef APP_ARM64_NAME
      !ifndef APP_64_NAME
        StrCpy $3 "arm64"  ; App is ARM64 only
      !endif
    !endif
    !ifdef APP_64_NAME
      !ifndef APP_ARM64_NAME
        StrCpy $3 "x64"    ; App is x64 only
      !endif
    !endif
    !ifdef APP_64_NAME
      !ifdef APP_ARM64_NAME
        StrCpy $3 "universal"  ; Both architectures available
      !endif
    !endif

    ; If no architecture variables are defined, assume x64
    ${If} $3 == ""
      StrCpy $3 "x64"
    ${EndIf}

    ; Compare system and app architectures
    ${If} $3 == "universal"
      ; Universal build, compatible with all architectures
      StrCpy $0 "1"
    ${ElseIf} $1 == $3
      ; Architectures match
      StrCpy $0 "1"
    ${Else}
      ; Architectures don't match
      StrCpy $0 "0"
    ${EndIf}
  FunctionEnd

  ; Minimum supported Windows version: Windows 10 1809 (build 17763, 64-bit),
  ; including Windows 11 (which also reports major version 10). Windows 7/8/8.1
  ; (NT 6.x) and earlier are unsupported, including launches through
  ; third-party compatibility layers. Sets $0 to "1" when supported.
  Function checkWindowsVersion
    Push $R0
    Push $R1
    StrCpy $0 "0"
    ReadRegDWORD $R0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentMajorVersionNumber"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
    ; Legacy systems (Win7/8/8.1) have no CurrentMajorVersionNumber value.
    ${If} $R0 == ""
      StrCpy $R0 "0"
    ${EndIf}
    ${If} $R1 == ""
      StrCpy $R1 "0"
    ${EndIf}
    IntCmp $R0 10 checkWinVer_isWin10 checkWinVer_older checkWinVer_newer
    checkWinVer_older:
      StrCpy $0 "0"
      Goto checkWinVer_done
    checkWinVer_newer:
      StrCpy $0 "1"
      Goto checkWinVer_done
    checkWinVer_isWin10:
      IntCmp $R1 17763 checkWinVer_supported checkWinVer_unsupported checkWinVer_supported
    checkWinVer_unsupported:
      StrCpy $0 "0"
      Goto checkWinVer_done
    checkWinVer_supported:
      StrCpy $0 "1"
    checkWinVer_done:
      Pop $R1
      Pop $R0
  FunctionEnd
!endif

!macro preInit
  ; Capture the directory the template just created with `SetOutPath $INSTDIR`
  ; before `initMultiUser` can rewrite $INSTDIR. The OS gate in `customInit`
  ; must only attempt cleanup of this directory — never the final $INSTDIR,
  ; which may be a pre-existing empty per-user directory this invocation did
  ; not create. See `customInit` for the best-effort empty-dir cleanup and its
  ; template-ordering limitation.
  StrCpy $osSupportInitialInstDir $INSTDIR
!macroend

!macro customInit
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4

  ; Check minimum Windows version FIRST, before elevation/arch/VC++ work.
  ; Windows 7/8/8.1 and earlier cannot run this build (Electron 23+ requires
  ; Windows 10+); third-party compatibility layers are not supported either.
  ; NOTE: the electron-builder template issues `SetOutPath $INSTDIR` in
  ; `.onInit` before `preInit`/`customInit` run, which creates $INSTDIR
  ; (including a `/D=` destination that did not exist). There is no hook
  ; before that first creation, so a perfect no-change abort is impossible.
  ; Best effort below: leave the working directory before removing, and only
  ; remove the template-created initial directory when it is empty — never
  ; the final $INSTDIR selected by `initMultiUser`, which may pre-exist empty.
  ; `RMDir` only succeeds on empty directories, so an existing install with
  ; files is never deleted. The copy below promises "not installed" rather
  ; than zero filesystem side effects for this reason.
  Call checkWindowsVersion
  ${If} $0 != "1"
    StrCpy $4 "https://cherryai.com/"
    ${If} $LANGUAGE == ${LANG_SIMPCHINESE}
    ${OrIf} $LANGUAGE == ${LANG_TRADCHINESE}
      StrCpy $4 "https://cherryai.com.cn/"
    ${EndIf}
    MessageBox MB_ICONSTOP "\
      Unsupported Windows Version$\r$\n$\r$\n\
      Cherry Studio requires Windows 10 1809 (build 17763, 64-bit) or later, including Windows 11.$\r$\n\
      Windows 7, 8 and 8.1 are not supported, including launches through third-party compatibility layers.$\r$\n\
      The application was not installed.$\r$\n$\r$\n\
      当前 Windows 版本不受支持，需要 Windows 10 1809（内部版本 17763，64 位）或更高版本（含 Windows 11）。$\r$\n\
      Windows 7 / 8 / 8.1 不受支持，通过第三方兼容层启动也不属于官方支持。本次未安装应用。$\r$\n$\r$\n\
      Past installers remain available on GitHub Releases for reference only (no support or security updates).$\r$\n\
      Supported downloads and documents:$\r$\n\
      $4"
    ExecShell "open" "$4"
    ; Best-effort cleanup of the template-created directory only. Leave the
    ; working directory first: when $INSTDIR is the working directory Windows
    ; refuses to remove it, leaving the `/D=` destination behind. Never clean
    ; the final $INSTDIR here — after `initMultiUser` it may be a pre-existing
    ; empty per-user directory this invocation did not create.
    SetOutPath $TEMP
    RMDir "$osSupportInitialInstDir"
    Abort
  ${EndIf}

  ; If a per-machine (all users) installation exists, ensure we have admin privileges.
  ; Without elevation, the installer cannot close the running app or manage the
  ; per-machine installation, causing "cannot close app" errors during both
  ; silent updates and manual reinstalls.
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "QuietUninstallString"
  ${If} $R0 != ""
    UserInfo::GetAccountType
    Pop $R1
    ${If} $R1 != "admin"
      ${GetParameters} $R2
      ExecShell "runas" "$EXEPATH" "$R2"
      ${If} ${Errors}
        SetErrorLevel 1
      ${Else}
        SetErrorLevel 0
      ${EndIf}
      Quit
    ${EndIf}
  ${EndIf}

  ; Check architecture compatibility first
  Call checkArchitectureCompatibility
  ${If} $0 != "1"
    StrCpy $4 "https://cherryai.com/"
    ${If} $LANGUAGE == ${LANG_SIMPCHINESE}
    ${OrIf} $LANGUAGE == ${LANG_TRADCHINESE}
      StrCpy $4 "https://cherryai.com.cn/"
    ${EndIf}
    MessageBox MB_ICONEXCLAMATION "\
      Architecture Mismatch$\r$\n$\r$\n\
      This installer is not compatible with your system architecture.$\r$\n\
      Your system: $1$\r$\n\
      App architecture: $3$\r$\n$\r$\n\
      Please download the correct version from:$\r$\n\
      $4"
    ExecShell "open" "$4"
    Abort
  ${EndIf}

  Call checkVCRedist
  ${If} $0 != "1"
    ; VC++ is required - install automatically since declining would abort anyway
    ; Select download URL based on system architecture (stored in $1)
    ${If} $1 == "arm64"
      StrCpy $2 "https://aka.ms/vs/17/release/vc_redist.arm64.exe"
      StrCpy $3 "$TEMP\vc_redist.arm64.exe"
    ${Else}
      StrCpy $2 "https://aka.ms/vs/17/release/vc_redist.x64.exe"
      StrCpy $3 "$TEMP\vc_redist.x64.exe"
    ${EndIf}

    inetc::get /CAPTION " " /BANNER "Downloading Microsoft Visual C++ Redistributable..." \
      $2 $3 /END
    Pop $0  ; Get download status from inetc::get
    ${If} $0 != "OK"
      MessageBox MB_ICONSTOP|MB_YESNO "\
        Failed to download Microsoft Visual C++ Redistributable.$\r$\n$\r$\n\
        Error: $0$\r$\n$\r$\n\
        Would you like to open the download page in your browser?$\r$\n\
        $2" IDYES openDownloadUrl IDNO skipDownloadUrl
      openDownloadUrl:
        ExecShell "open" $2
      skipDownloadUrl:
      Abort
    ${EndIf}

    ExecWait "$3 /install /quiet /norestart"
    ; Note: vc_redist exit code is unreliable, verify via registry check instead

    Call checkVCRedist
    ${If} $0 != "1"
      MessageBox MB_ICONSTOP|MB_YESNO "\
        Microsoft Visual C++ Redistributable installation failed.$\r$\n$\r$\n\
        Would you like to open the download page in your browser?$\r$\n\
        $2$\r$\n$\r$\n\
        The installation of ${PRODUCT_NAME} cannot continue." IDYES openInstallUrl IDNO skipInstallUrl
      openInstallUrl:
        ExecShell "open" $2
      skipInstallUrl:
      Abort
    ${EndIf}
  ${EndIf}
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
!macroend
