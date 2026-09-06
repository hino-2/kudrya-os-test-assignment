#!/bin/sh
# node:22-alpine несёт только busybox sh, bash в образе нет.
set -eu

# Ожидания готовности БД здесь нет намеренно: в docker-compose api стартует по
# condition: service_healthy у postgres, а при прямом docker run без БД миграция падает
# сразу и с внятной ошибкой драйвера — это громче и диагностичнее, чем 30 секунд
# молчаливого цикла pg_isready по захардкоженному хосту.
echo "🔧 Running migrations..."
node apps/api/dist/common/db/migrate.js

echo "🚀 Starting application..."
exec node apps/api/dist/main.js
