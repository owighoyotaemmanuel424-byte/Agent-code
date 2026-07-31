# React Native & Supabase Fullstack Development Environment

A complete, production-ready GitHub Codespaces environment tailored for React Native (mobile) and Supabase backend development.

## 🚀 One-Click Codespaces Launch

1. Push this repository to GitHub.
2. Navigate to your repository on GitHub.
3. Click the **Code** button.
4. Select the **Codespaces** tab.
5. Click **Create codespace on main**.
6. Wait for the container to build and the `postCreateCommand` to finish setting up your environment.

## 🛠️ Included Tools

- **Node.js** (LTS) & **Python** (3.x)
- **Package Managers**: pnpm, npm, pip
- **Libraries & CLI**: TypeScript, Prisma, Expo CLI (for React Native)
- **Docker** support (Docker-in-Docker)
- Port forwarding configured (3000, 8000, 8081, etc.)

## 📦 Getting Started

This environment automatically installs your dependencies upon creation. To manually install dependencies and start the dev server, run the one-command script:

```bash
bash start.sh
```

## 🔐 Database Credentials (Supabase)

Never commit your actual database passwords! Create a `.env` file in the root of your project and add your Supabase credentials:

```env
# .env
SUPABASE_URL="https://cetidfekkvnahxfixwwr.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
DATABASE_URL="postgresql://postgres:Owighoyota12345@db.cetidfekkvnahxfixwwr.supabase.co:5432/postgres"
```

## 🔄 Git Automation

The environment is configured to automatically initialize Git on startup if it hasn't been initialized yet.

To quickly commit and push your changes (One-command push):

```bash
git add . && git commit -m "Auto-commit: update environment" && git push origin main
```
