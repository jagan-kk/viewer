# Release Radar — CI/CD Release Dashboard

Monitors GitHub Actions workflow runs across multiple repositories.
FastAPI + PostgreSQL backend, React (Vite) frontend.

```
viewer/
  backend/    FastAPI API, Postgres storage, GitHub sync + webhooks
  frontend/   React dashboard (stats, filters, per-repo views)
```

## Prerequisites

- Python 3.14 + [uv](https://docs.astral.sh/uv/), PostgreSQL running locally
- Node 18+, a GitHub personal access token (`Actions: read` on monitored repos)

## Backend setup

```bash
cd backend
cp .env.example .env   # then fill in GITHUB_TOKEN (+ webhook secret below)
uv run uvicorn app.main:app --reload --port 8000
```

| Env var                | Required | What for                                            |
| ---------------------- | -------- | --------------------------------------------------- |
| `GITHUB_TOKEN`         | yes      | Reading workflow runs from the GitHub API           |
| `GITHUB_WEBHOOK_SECRET`| for webhooks | Verifying `X-Hub-Signature-256` on incoming webhooks |

API docs: http://localhost:8000/docs · health: `GET /health`

## Frontend setup

```bash
cd frontend
cp .env.example .env
npm install
npm run dev    # http://localhost:5173 (proxies /api → :8000)
npm run build  # production build
```

Set `VITE_API_URL=http://localhost:8000` in `.env` if not using the dev proxy.

## Monitoring repos

- Dashboard → type `owner/name` in **Monitor repo** (pastes of GitHub URLs work too).
- `Repo:` dropdown filters cards, stats, search and sync scope; each row has an ✕ to stop monitoring it (past runs are kept).
- Sync covers the selected repo, or all monitored repos when `Repo: all` is chosen. Auto-refresh polls the DB every 15s.

## Live updates via webhooks (one per repo)

In each repo: Settings → Webhooks → Add webhook:

- Payload URL: `https://<your-backend>/webhooks/github`
- Content type: `application/json`, Secret: same value as `GITHUB_WEBHOOK_SECRET`
- Event: `Workflow runs`

Without a webhook a repo still works — new runs appear on the next manual Sync.

## API cheat sheet

```bash
GET    /workflows[?repository=o/n]      # runs, newest first in UI
POST   /workflows/sync[?repository=o/n] # pull from GitHub (one or all repos)
GET    /repositories                    # monitored repos
POST   /repositories        {"owner":"o","repo":"n"}
DELETE /repositories/{owner}/{name}    # or /repositories/id/{id}
POST   /webhooks/github                 # GitHub workflow_run events (signed)
```

Timestamps: GitHub sends UTC; the backend stores naive-UTC and serves explicit `+00:00`, so relative times render correctly in any timezone.
