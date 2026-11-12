@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "%~dp0scripts\dev-control.mjs" stop
ping -n 4 127.0.0.1 >nul
