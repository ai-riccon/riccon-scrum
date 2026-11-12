@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "%~dp0scripts\dev-control.mjs" start
if errorlevel 1 pause
