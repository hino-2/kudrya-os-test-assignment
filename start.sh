#!/bin/bash
set -e

NO_SEED=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-seed)
            NO_SEED=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "🚀 Starting Docker containers..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not available. Please install Docker."
    exit 1
fi

# Check if .env exists, if not copy from .env.example
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "📋 Creating .env from .env.example..."
        cp .env.example .env
    else
        echo "⚠️  No .env or .env.example found. Proceeding with defaults..."
    fi
fi

# Start containers
echo "▶️  Running docker compose up -d..."
docker compose up -d

echo "⏳ Waiting for postgres to be ready..."
attempts=0
max_attempts=30
while [ $attempts -lt $max_attempts ]; do
    if docker compose exec -T postgres pg_isready -U postgres -d store > /dev/null 2>&1; then
        echo "✅ PostgreSQL is ready!"
        break
    fi
    sleep 1
    ((attempts++))
done

if [ $attempts -eq $max_attempts ]; then
    echo "⚠️  PostgreSQL did not respond after $max_attempts seconds, but proceeding..."
fi

echo "⏳ Waiting for API to be ready..."
attempts=0
while [ $attempts -lt 20 ]; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
        echo "✅ API is ready!"
        break
    fi
    sleep 1
    ((attempts++))
done

echo "⏳ Waiting for migrations to complete in api container..."
sleep 3

if [ "$NO_SEED" != "true" ]; then
    echo "🌱 Seeding catalog..."
    npm run seed:catalog
    echo "✅ Catalog seeded!"
fi

echo ""
echo "✨ All containers are running!"
echo ""
echo "📍 Service endpoints:"
echo "   API:        http://localhost:3000"
echo "   Supplier A: http://localhost:4001"
echo "   Supplier B: http://localhost:4002"
echo "   Database:   localhost:5432"
echo ""
echo "🧪 Quick checks:"
echo "   curl -i http://localhost:3000/health"
echo "   curl -s http://localhost:3000/catalog | head -c 300"
echo "   npm run race -- --sku KEY-GTA5 --count 50"
echo ""
echo "🛑 To stop: docker compose down"
