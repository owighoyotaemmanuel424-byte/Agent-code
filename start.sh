#!/bin/bash
set -e

echo "Installing dependencies..."
if [ -f "package.json" ]; then
  pnpm install
fi

echo "Starting development servers..."
if grep -q "expo" package.json; then
    # React Native (Expo)
    npx expo start --tunnel
else
    # Fallback to standard npm dev script
    npm run dev
fi
