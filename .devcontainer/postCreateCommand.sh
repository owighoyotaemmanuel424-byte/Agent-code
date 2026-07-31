#!/bin/bash
set -e

echo "Setting up development environment..."

# Install global tools
npm install -g pnpm npm typescript prisma expo-cli @expo/ngrok

# Setup Python tools
pip install --upgrade pip

# Git initialization if not already a repo
if [ ! -d ".git" ]; then
  git init
  git branch -M main
  git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
  echo "Git repository initialized."
fi

# Install local dependencies if package.json exists
if [ -f "package.json" ]; then
  pnpm install
fi

echo "Environment setup complete!"
