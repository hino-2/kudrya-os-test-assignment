#!/bin/bash
set -e

echo "⏳ Waiting for database connection..."
timeout=30
while [ $timeout -gt 0 ]; do
  if pg_isready -h postgres -U postgres -d store 2>/dev/null; then
    echo "✅ Database is ready"
    break
  fi
  timeout=$((timeout - 1))
  sleep 1
done

if [ $timeout -eq 0 ]; then
  echo "❌ Database did not become ready in time"
  exit 1
fi

echo "🔧 Running migrations..."
node node_modules/typeorm/cli.js migration:run -d apps/api/dist/common/db/data-source.js

echo "🚀 Starting application..."
exec node apps/api/dist/main.js
