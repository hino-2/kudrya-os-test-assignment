#!/bin/bash
set -e

SEED=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --seed)
            SEED=true
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
if ! docker compose up -d; then
    echo "❌ Docker compose failed."
    exit 1
fi

echo "⏳ Waiting for postgres to be ready..."
attempts=0
max_attempts=30
while [ $attempts -lt $max_attempts ]; do
    if docker compose exec -T postgres pg_isready -U postgres -d store > /dev/null 2>&1; then
        echo "✅ PostgreSQL is ready!"
        break
    fi
    sleep 1
    # ((attempts++)) would abort the script under set -e: at attempts=0 the expression
    # evaluates to 0, so the command exits 1. Increment via assignment instead.
    attempts=$((attempts + 1))
done

if [ $attempts -eq $max_attempts ]; then
    echo "⚠️  PostgreSQL did not respond after $max_attempts seconds, but proceeding..."
fi

echo "⏳ Waiting for API to be ready..."
attempts=0
max_api_attempts=20
api_ready=false
while [ $attempts -lt $max_api_attempts ]; do
    # --max-time is required: without it a container that accepts TCP but never answers makes
    # curl block forever, the loop never advances and the fatal check below is never reached.
    http_code=$(curl -s --max-time 2 -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
        echo "✅ API is ready!"
        api_ready=true
        break
    fi
    sleep 1
    attempts=$((attempts + 1))
done

if [ "$api_ready" != "true" ]; then
    echo "❌ API did not answer /health after $max_api_attempts attempts."
    echo "   Logs: docker compose logs api"
    exit 1
fi

echo "⏳ Waiting for migrations to complete in api container..."
sleep 3

if [ "$SEED" = "true" ]; then
    echo "🌱 Seeding catalog..."

    if ! npm run seed:catalog; then
        echo "❌ Seeding failed."
        exit 1
    fi

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
echo ""
echo "🌱 To seed catalog: npm run seed:catalog"
