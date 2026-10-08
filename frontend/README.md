# Release Radar — Frontend

React (Vite) dashboard for the CI/CD Release Dashboard backend.

## Setup

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

- Dev server: http://localhost:5173
- `/api/*` is proxied to `http://localhost:8000` (see `vite.config.js`).
- To point elsewhere: `VITE_API_URL=http://localhost:8000` in `.env`.

Backend must be running with CORS enabled:

```bash
cd ../backend
uv run uvicorn app.main:app --reload --port 8000
```

## Features

- Stats: total, success rate, successful, failed, in-progress
- Search + status / conclusion / branch filters + newest/oldest sort
- Auto-refresh (15s), Sync from GitHub button, health indicator
- Card grid with detail modal, GitHub deep-links, responsive dark UI
