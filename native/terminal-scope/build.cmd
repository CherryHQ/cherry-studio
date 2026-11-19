@echo off
setlocal
set "TERMINAL_ARCH=%~1"
if /i "%TERMINAL_ARCH%"=="arm64" (set "TERMINAL_VC_ARCH=x64_arm64") else if /i "%TERMINAL_ARCH%"=="x64" (set "TERMINAL_VC_ARCH=x64") else exit /b 1
set "TERMINAL_VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%TERMINAL_VSWHERE%" exit /b 1
for /f "usebackq tokens=*" %%i in (`"%TERMINAL_VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "TERMINAL_VS_ROOT=%%i"
if not defined TERMINAL_VS_ROOT exit /b 1
call "%TERMINAL_VS_ROOT%\VC\Auxiliary\Build\vcvarsall.bat" %TERMINAL_VC_ARCH%
if errorlevel 1 exit /b 1
cl /nologo /std:c11 /O2 /MT /W4 /WX /DUNICODE /D_UNICODE "%~dp0terminalScopeWindows.c" /Fo"%~2\terminalScope.obj" /Fe"%~2\terminal-scope.exe" /link /INCREMENTAL:NO ws2_32.lib user32.lib
exit /b %errorlevel%
