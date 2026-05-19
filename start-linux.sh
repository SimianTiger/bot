#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Iniciando Transcreve Bot..."
echo "Use CTRL+C para parar."
node --no-deprecation index.js
