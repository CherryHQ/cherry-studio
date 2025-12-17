;Inspired by:
; https://gist.github.com/bogdibota/062919938e1ed388b3db5ea31f52955c
; https://stackoverflow.com/questions/34177547/detect-if-visual-c-redistributable-for-visual-studio-2013-is-installed
; https://stackoverflow.com/a/54391388
; https://github.com/GitCommons/cpp-redist-nsis/blob/main/installer.nsh

;Find latests downloads here:
; https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist

!include LogicLib.nsh
!include x64.nsh

; https://github.com/electron-userland/electron-builder/issues/1122
!ifndef BUILD_UNINSTALLER
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
!endif

!macro customInit
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4

  ; Check architecture compatibility first
  Call checkArchitectureCompatibility
  ${If} $0 != "1"
    MessageBox MB_ICONEXCLAMATION "\
      Architecture Mismatch$\r$\n$\r$\n\
      This installer is not compatible with your system architecture.$\r$\n\
      Your system: $1$\r$\n\
      App architecture: $3$\r$\n$\r$\n\
      Please download the correct version from:$\r$\n\
      https://www.cherry-ai.com/"
    ExecShell "open" "https://www.cherry-ai.com/"
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
