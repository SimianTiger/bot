@echo off
cd /d "%~dp0"
title Transcreve Bot - Em andamento
color 0A
echo Iniciando os modulos do bot...
echo.
node --no-deprecation index.js
pause
