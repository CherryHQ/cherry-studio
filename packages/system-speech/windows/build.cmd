@echo off
setlocal
cl /nologo /std:c++17 /EHsc /W4 /WX /utf-8 /DWIN32_LEAN_AND_MEAN /DNOMINMAX /DUNICODE /D_UNICODE "%~dp0SystemSpeechHelper.cpp" /link /out:"%~dp0cherry-system-speech.exe" sapi.lib ole32.lib windowsapp.lib
exit /b %errorlevel%
