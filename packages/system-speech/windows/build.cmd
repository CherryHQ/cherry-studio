@echo off
setlocal
if /i "%VSCMD_ARG_TGT_ARCH%"=="x64" goto compile
set "SPEECH_VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%SPEECH_VSWHERE%" (
  echo Visual Studio C++ x64 tools, ATL and the Windows SDK are required. 1>&2
  exit /b 1
)
for /f "usebackq tokens=*" %%i in (`"%SPEECH_VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.ATL -property installationPath`) do set "SPEECH_VS_ROOT=%%i"
if not defined SPEECH_VS_ROOT (
  echo Visual Studio C++ x64 tools with ATL were not found. 1>&2
  exit /b 1
)
call "%SPEECH_VS_ROOT%\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 exit /b 1

:compile
set "SPEECH_OUTPUT=%~1"
if not defined SPEECH_OUTPUT set "SPEECH_OUTPUT=%~dp0..\dist\native\win32-x64"
if not exist "%SPEECH_OUTPUT%" mkdir "%SPEECH_OUTPUT%"
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /EHsc /O2 /MT /W4 /WX /external:anglebrackets /external:W0 /utf-8 /DWIN32_LEAN_AND_MEAN /DNOMINMAX /DUNICODE /D_UNICODE "%~dp0SystemSpeechHelper.cpp" /Fo"%SPEECH_OUTPUT%\SystemSpeechHelper.obj" /Fe"%SPEECH_OUTPUT%\cherry-system-speech.exe" /link /MACHINE:X64 /INCREMENTAL:NO sapi.lib ole32.lib windowsapp.lib
exit /b %errorlevel%
