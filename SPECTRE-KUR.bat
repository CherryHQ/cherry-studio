@echo off
REM Bu dosyaya SAG TIKLA -> "Yonetici olarak calistir" de.
REM node-pty modulunun derlenmesi icin gereken Visual Studio bilesenini kurar.

echo Visual Studio Spectre kitapliklari kuruluyor...
echo Bu islem birkac dakika surebilir, pencereyi kapatma.
echo.

"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe" modify ^
  --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" ^
  --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre ^
  --quiet --wait --norestart

echo.
if %ERRORLEVEL%==0 (
  echo TAMAM - bilesen kuruldu. Bu pencereyi kapatabilirsin.
) else (
  echo HATA - cikis kodu: %ERRORLEVEL%
)
pause
