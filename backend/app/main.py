from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timezone
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session
from fastapi import Depends, FastAPI, Request
from app import database
from app.database import get_db
from app.models.workflow import Repository as RepositoryModel
from app.models.workflow import WorkflowRun as WorkflowRunModel
from app.schemas.workflow import Repository as RepositorySchema
from app.schemas.workflow import RepositoryCreate
from app.schemas.workflow import WorkflowRun as WorkflowRunSchema
from app.services.github import GitHubClient
from fastapi import Depends, FastAPI, Request
from sqlalchemy.orm import Session

DEFAULT_OWNER = "jagan-kk"
DEFAULT_REPO = "viewer_test"

_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def _to_naive_utc(value):
    """Normalize a GitHub ISO-8601 timestamp to naive UTC for DB storage."""
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _as_utc_aware(value):
    """Treat a stored naive datetime as UTC for API responses."""
    if value is None:
        return None
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _to_workflow_schema(row: WorkflowRunModel) -> WorkflowRunSchema:
    return WorkflowRunSchema(
        id=row.id,
        name=row.name,
        run_number=row.run_number,
        branch=row.branch,
        status=row.status,
        conclusion=row.conclusion,
        commit_sha=row.commit_sha,
        created_at=_as_utc_aware(row.created_at),
        updated_at=_as_utc_aware(row.updated_at),
        html_url=row.html_url,
        repository=row.repository,
    )


def _to_repo_schema(row: RepositoryModel) -> RepositorySchema:
    return RepositorySchema(
        id=row.id,
        owner=row.owner,
        name=row.name,
        full_name=f"{row.owner}/{row.name}",
    )


def _upsert_run(db: Session, run: dict, full_name: str) -> WorkflowRunSchema:
    """Insert or update one workflow run. Caller commits."""
    created_naive = _to_naive_utc(run["created_at"])
    updated_naive = _to_naive_utc(run["updated_at"])

    existing = db.get(WorkflowRunModel, run["id"])

    if existing:
        existing.name = run["name"]
        existing.run_number = run["run_number"]
        existing.branch = run["head_branch"]
        existing.status = run["status"]
        existing.conclusion = run["conclusion"]
        existing.commit_sha = run["head_sha"]
        existing.created_at = created_naive
        existing.updated_at = updated_naive
        existing.html_url = run["html_url"]
        existing.repository = full_name
    else:
        db.add(
            WorkflowRunModel(
                id=run["id"],
                name=run["name"],
                run_number=run["run_number"],
                branch=run["head_branch"],
                status=run["status"],
                conclusion=run["conclusion"],
                commit_sha=run["head_sha"],
                created_at=created_naive,
                updated_at=updated_naive,
                html_url=run["html_url"],
                repository=full_name,
            )
        )

    return WorkflowRunSchema(
        id=run["id"],
        name=run["name"],
        run_number=run["run_number"],
        branch=run["head_branch"],
        status=run["status"],
        conclusion=run["conclusion"],
        commit_sha=run["head_sha"],
        created_at=_as_utc_aware(created_naive),
        updated_at=_as_utc_aware(updated_naive),
        html_url=run["html_url"],
        repository=full_name,
    )


def _get_targets(
    db: Session,
    repository: str | None = None,
    owner: str | None = None,
    repo: str | None = None,
) -> list[tuple[str, str]]:
    """Resolve which repos to sync: explicit params win, else all monitored repos."""
    if owner and repo:
        return [(owner.strip(), repo.strip())]
    if repository:
        o, _, n = repository.partition("/")
        if not o.strip() or not n.strip():
            raise HTTPException(status_code=400, detail="Use owner/repo format for repository")
        return [(o.strip(), n.strip())]
    rows = db.query(RepositoryModel).order_by(RepositoryModel.owner, RepositoryModel.name).all()
    if rows:
        return [(r.owner, r.name) for r in rows]
    return [(DEFAULT_OWNER, DEFAULT_REPO)]


def _ensure_multi_repo_schema() -> None:
    """Additive-only upgrade for pre-existing databases: no tables dropped, no rows deleted."""
    from sqlalchemy import text

    with database.engine.begin() as conn:
        conn.execute(text("ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS repository VARCHAR"))
        conn.execute(
            text("UPDATE workflow_runs SET repository = :full WHERE repository IS NULL"),
            {"full": f"{DEFAULT_OWNER}/{DEFAULT_REPO}"},
        )
    db = database.SessionLocal()
    try:
        if not db.query(RepositoryModel).first():
            db.add(RepositoryModel(owner=DEFAULT_OWNER, name=DEFAULT_REPO))
            db.commit()
    finally:
        db.close()


class _WorkflowRunPayload(BaseModel):
    id: int
    name: str
    run_number: int
    head_branch: str
    status: str
    conclusion: str | None = None
    head_sha: str
    created_at: str
    updated_at: str
    html_url: str


class _WebhookRepository(BaseModel):
    full_name: str | None = None


class _WebhookPayload(BaseModel):
    workflow_run: _WorkflowRunPayload | None = None
    repository: _WebhookRepository | None = None


def _verify_webhook_signature(body: bytes, signature: str | None) -> None:
    secret = os.getenv("GITHUB_WEBHOOK_SECRET")
    if not secret:
        return
    if not signature or not signature.startswith("sha256="):
        raise HTTPException(status_code=401, detail="Missing webhook signature")
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(f"sha256={expected}", signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")


def _github_client() -> GitHubClient:
    try:
        return GitHubClient()
    except ValueError:
        raise HTTPException(status_code=503, detail="GITHUB_TOKEN is not set")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        database.init_db()
    except Exception as exc:
        print(f"WARNING: database init failed, running degraded: {exc}")
    try:
        _ensure_multi_repo_schema()
    except Exception as exc:
        print(f"WARNING: schema migration failed, running degraded: {exc}")
    if not os.getenv("GITHUB_WEBHOOK_SECRET"):
        print("WARNING: GITHUB_WEBHOOK_SECRET is not set — webhook signatures are not verified")
    yield


app = FastAPI(title="CI/CD Release Dashboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "CI/CD Dashboard API is running"}


@app.get("/health")
def health():
    db_up = database.check_db()
    return {"status": "healthy" if db_up else "degraded", "database": "up" if db_up else "down"}


@app.post(
    "/workflows/sync",
    response_model=list[WorkflowRunSchema],
)
async def sync_workflows(
    repository: str | None = None,
    owner: str | None = None,
    repo: str | None = None,
    db: Session = Depends(get_db),
):
    targets = _get_targets(db, repository=repository, owner=owner, repo=repo)
    gh = _github_client()

    workflows: list[WorkflowRunSchema] = []

    for target_owner, target_repo in targets:
        try:
            data = await gh.get_workflow_runs(
                owner=target_owner,
                repo=target_repo,
            )
        except Exception as exc:
            if len(targets) == 1:
                raise HTTPException(
                    status_code=502,
                    detail=f"GitHub sync failed for {target_owner}/{target_repo}: {exc}",
                )
            print(f"Sync failed for {target_owner}/{target_repo}: {exc}")
            continue

        full_name = f"{target_owner}/{target_repo}"
        for run in data.get("workflow_runs", []):
            workflows.append(_upsert_run(db, run, full_name))

    # Save everything once
    db.commit()

    return workflows


@app.get(
    "/repositories",
    response_model=list[RepositorySchema],
)
def list_repositories(db: Session = Depends(get_db)):
    rows = db.query(RepositoryModel).order_by(RepositoryModel.owner, RepositoryModel.name).all()
    return [_to_repo_schema(r) for r in rows]


@app.post(
    "/repositories",
    response_model=RepositorySchema,
    status_code=201,
)
def add_repository(payload: RepositoryCreate, db: Session = Depends(get_db)):
    owner = (payload.owner or "").strip()
    name = ((payload.name or payload.repo) or "").strip()
    if not owner or not name:
        raise HTTPException(status_code=422, detail="Both owner and repo name are required")
    if not _NAME_RE.match(owner) or not _NAME_RE.match(name):
        raise HTTPException(
            status_code=422,
            detail="Use plain owner/name (e.g. jagan-kk/BitBug), not a URL",
        )

    existing = (
        db.query(RepositoryModel)
        .filter(RepositoryModel.owner == owner, RepositoryModel.name == name)
        .first()
    )
    if existing:
        return _to_repo_schema(existing)

    row = RepositoryModel(owner=owner, name=name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_repo_schema(row)


@app.delete("/repositories/id/{repo_id:int}", status_code=204)
def remove_repository_by_id(repo_id: int, db: Session = Depends(get_db)):
    row = db.get(RepositoryModel, repo_id)
    if not row:
        raise HTTPException(status_code=404, detail="Repository is not monitored")
    db.delete(row)
    db.commit()
    return None


@app.delete("/repositories/{owner}/{name}", status_code=204)
def remove_repository(owner: str, name: str, db: Session = Depends(get_db)):
    row = (
        db.query(RepositoryModel)
        .filter(RepositoryModel.owner == owner, RepositoryModel.name == name)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Repository is not monitored")
    db.delete(row)
    db.commit()
    return None


@app.get(
    "/workflows",
    response_model=list[WorkflowRunSchema],
)
def get_workflows(repository: str | None = None, db: Session = Depends(get_db)):

    # Read ONLY from PostgreSQL
    query = db.query(WorkflowRunModel)
    if repository:
        query = query.filter(WorkflowRunModel.repository == repository)
    workflows = query.all()

    return [_to_workflow_schema(w) for w in workflows]

@app.post("/webhooks/github")
async def github_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    raw = await request.body()
    _verify_webhook_signature(raw, request.headers.get("X-Hub-Signature-256"))

    try:
        payload = _WebhookPayload.model_validate(json.loads(raw or b"{}"))
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid webhook payload: {exc}")

    # Only process workflow_run events (e.g. ignore ping)
    if payload.workflow_run is None:
        return {"message": "Ignored event"}

    run = payload.workflow_run

    full_name = (
        (payload.repository.full_name if payload.repository else None)
        or f"{DEFAULT_OWNER}/{DEFAULT_REPO}"
    )

    # Check whether this workflow run already exists
    existing = db.get(WorkflowRunModel, run.id)

    if existing:
        # Update existing workflow run
        existing.name = run.name
        existing.run_number = run.run_number
        existing.branch = run.head_branch
        existing.status = run.status
        existing.conclusion = run.conclusion
        existing.commit_sha = run.head_sha
        existing.created_at = _to_naive_utc(run.created_at)
        existing.updated_at = _to_naive_utc(run.updated_at)
        existing.html_url = run.html_url
        existing.repository = full_name

        print(f"Updated workflow run: {run.id}")

    else:
        # Create new workflow run
        workflow_db = WorkflowRunModel(
            id=run.id,
            name=run.name,
            run_number=run.run_number,
            branch=run.head_branch,
            status=run.status,
            conclusion=run.conclusion,
            commit_sha=run.head_sha,
            created_at=_to_naive_utc(run.created_at),
            updated_at=_to_naive_utc(run.updated_at),
            html_url=run.html_url,
            repository=full_name,
        )

        db.add(workflow_db)

        print(f"Inserted workflow run: {run.id}")

    db.commit()

    return {
        "message": "Workflow run saved",
        "workflow_run_id": run.id,
        "status": run.status,
        "conclusion": run.conclusion,
        "repository": full_name,
    }