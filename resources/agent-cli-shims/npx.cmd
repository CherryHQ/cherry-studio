@echo off
if "%CHERRY_STUDIO_BUN_PATH%"=="" (
  echo Cherry Studio could not locate its bundled Bun runtime. 1>&2
  exit /b 127
)
set "cherry_npx_arg=%~1"
if "%cherry_npx_arg%"=="" goto bundled
if not "%cherry_npx_arg:~0,1%"=="-" goto bundled
if /I "%cherry_npx_arg%"=="-y" goto bundled
if /I "%cherry_npx_arg%"=="--yes" goto bundled
if /I "%cherry_npx_arg%"=="-p" goto bundled
if /I "%cherry_npx_arg%"=="--package" goto bundled
if /I "%cherry_npx_arg%"=="--no-install" goto bundled
for /f "delims=" %%I in ('where npx.cmd 2^>nul') do (
  if /I not "%%~fI"=="%~f0" (
    echo Cherry Studio: passing unsupported npx runner options to system npx. 1>&2
    "%%~fI" %*
    exit /b %errorlevel%
  )
)
:bundled
echo Cherry Studio: routing npx to bundled bun x. 1>&2
"%CHERRY_STUDIO_BUN_PATH%" x %*
exit /b %errorlevel%
