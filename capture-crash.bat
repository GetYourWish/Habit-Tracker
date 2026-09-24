@echo off
setlocal

REM ============================================================
REM  Habit Tracker - one-click crash log capture
REM
REM  Double-click this file with the phone connected over USB.
REM  It saves three text files to your Desktop; send them all.
REM ============================================================

set "PKG=com.getyourwish.performancetracker"
set "OUT=%USERPROFILE%\Desktop"
if not exist "%OUT%" set "OUT=%USERPROFILE%"

set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if exist "%ADB%" goto have_adb
where adb >nul 2>nul
if errorlevel 1 goto no_adb
set "ADB=adb"
goto have_adb

:no_adb
echo.
echo [X] adb.exe was not found.
echo     Expected at: %LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
echo     If your Android SDK lives somewhere else, edit this file.
echo.
pause
exit /b 1

:have_adb
echo.
echo ============================================================
echo  Habit Tracker - crash log capture
echo ============================================================
echo.

"%ADB%" get-state >nul 2>nul
if errorlevel 1 goto no_device

echo Capturing... do not close this window.
echo.

"%ADB%" shell dumpsys package %PKG% > "%OUT%\perf-tracker-package.txt" 2>&1
"%ADB%" logcat -b crash -d > "%OUT%\perf-tracker-crash.txt" 2>&1
"%ADB%" logcat -d -t 3000 > "%OUT%\perf-tracker-recent.txt" 2>&1
"%ADB%" shell getprop ro.product.model > "%OUT%\perf-tracker-device.txt" 2>&1
"%ADB%" shell getprop ro.build.version.release >> "%OUT%\perf-tracker-device.txt" 2>&1

set "SIZE="
for %%F in ("%OUT%\perf-tracker-crash.txt") do set "SIZE=%%~zF"

echo Done. Files saved to your Desktop:
echo    perf-tracker-crash.txt    - the crash itself (most important)
echo    perf-tracker-recent.txt   - what the phone was doing before
echo    perf-tracker-package.txt  - which app variant is installed
echo    perf-tracker-device.txt   - phone model and Android version
echo.
if "%SIZE%"=="" goto send
if %SIZE% LEQ 2 (
  echo NOTE: perf-tracker-crash.txt is EMPTY - no crash was recorded yet.
  echo Open the app now to make it crash, then run this file again.
  echo.
)
:send
echo Send ALL the files above back so the crash can be pinpointed.
echo.
pause
exit /b 0

:no_device
echo [X] No phone detected.
echo.
echo     1. Connect the phone with a USB cable
echo     2. On the phone: Settings ^> About phone ^> tap "Build number"
echo        7 times to unlock Developer options
echo     3. Settings ^> Developer options ^> enable "USB debugging"
echo     4. Plug in and accept the "Allow USB debugging?" popup
echo.
echo     Then run this file again.
echo.
pause
exit /b 1
