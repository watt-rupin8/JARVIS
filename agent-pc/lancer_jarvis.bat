@echo off
title JARVIS - Assistant PC
cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel%==0 goto :run_python

where py >nul 2>&1
if %errorlevel%==0 goto :run_py

echo [ERREUR] Python n'est pas installe sur ce PC.
echo Telechargez Python sur https://www.python.org/downloads/
echo Pensez a cocher "Add Python to PATH" lors de l'installation.
pause
exit /b 1

:run_python
python "%~dp0jarvis_pc.py"
pause
exit /b 0

:run_py
py "%~dp0jarvis_pc.py"
pause
exit /b 0
