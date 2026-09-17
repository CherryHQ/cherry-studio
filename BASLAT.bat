@echo off
REM Cherry Studio'yu gelistirme modunda baslatir.
REM pnpm PATH'te olmadigi icin yerel node_modules ikilisi dogrudan cagriliyor.
cd /d "%~dp0"
set "PATH=%PATH%;C:\Users\ag\AppData\Roaming\npm"

echo Uygulama baslatiliyor... Ilk acilis derleme yaptigi icin birkac dakika surebilir.
echo.

call "node_modules\.bin\electron-vite.cmd" dev

echo.
echo Uygulama kapandi. Pencereyi kapatmak icin bir tusa bas.
pause
