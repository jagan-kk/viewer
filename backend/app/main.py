from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from fastapi import Depends, FastAPI, Request
from app import database
from app.database import get_db
from app.models.workflow import WorkflowRun as WorkflowRunModel
from app.schemas.workflow import WorkflowRun as WorkflowRunSchema
from app.services.github import GitHubClient
from fastapi import Depends, FastAPI, Request
from sqlalchemy.orm import Session

app = FastAPI(title="CI/CD Release Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

github = GitHubClient()


@app.get("/")
def root():
    return {"message": "CI/CD Dashboard API is running"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post(
    "/workflows/sync",
    response_model=list[WorkflowRunSchema],
)
async def sync_workflows(db: Session = Depends(get_db)):
    # 1. Get latest workflow runs from GitHub
    data = await github.get_workflow_runs(
        owner="jagan-kk",
        repo="viewer_test",
    )

    workflows = []

    # 2. Insert or update workflows in PostgreSQL
    for run in data["workflow_runs"]:

        existing = db.get(WorkflowRunModel, run["id"])

        if existing:
            # Update existing workflow
            existing.name = run["name"]
            existing.run_number = run["run_number"]
            existing.branch = run["head_branch"]
            existing.status = run["status"]
            existing.conclusion = run["conclusion"]
            existing.commit_sha = run["head_sha"]
            existing.created_at = run["created_at"]
            existing.updated_at = run["updated_at"]
            existing.html_url = run["html_url"]

        else:
            # Insert new workflow
            workflow_db = WorkflowRunModel(
                id=run["id"],
                name=run["name"],
                run_number=run["run_number"],
                branch=run["head_branch"],
                status=run["status"],
                conclusion=run["conclusion"],
                commit_sha=run["head_sha"],
                created_at=run["created_at"],
                updated_at=run["updated_at"],
                html_url=run["html_url"],
            )

            db.add(workflow_db)

        # 3. Build API response
        workflow = WorkflowRunSchema(
            id=run["id"],
            name=run["name"],
            run_number=run["run_number"],
            branch=run["head_branch"],
            status=run["status"],
            conclusion=run["conclusion"],
            commit_sha=run["head_sha"],
            created_at=run["created_at"],
            updated_at=run["updated_at"],
            html_url=run["html_url"],
        )

        workflows.append(workflow)

    # 4. Save everything once
    db.commit()

    return workflows


@app.get(
    "/workflows",
    response_model=list[WorkflowRunSchema],
)
def get_workflows(db: Session = Depends(get_db)):

    # Read ONLY from PostgreSQL
    workflows = db.query(WorkflowRunModel).all()

    return [
        WorkflowRunSchema(
            id=workflow.id,
            name=workflow.name,
            run_number=workflow.run_number,
            branch=workflow.branch,
            status=workflow.status,
            conclusion=workflow.conclusion,
            commit_sha=workflow.commit_sha,
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            html_url=workflow.html_url,
        )
        for workflow in workflows
    ]

@app.post("/webhooks/github")
async def github_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    payload = await request.json()

    # Only process workflow_run events
    if "workflow_run" not in payload:
        return {"message": "Ignored event"}

    run = payload["workflow_run"]

    # Check whether this workflow run already exists
    existing = db.get(WorkflowRunModel, run["id"])

    if existing:
        # Update existing workflow run
        existing.name = run["name"]
        existing.run_number = run["run_number"]
        existing.branch = run["head_branch"]
        existing.status = run["status"]
        existing.conclusion = run["conclusion"]
        existing.commit_sha = run["head_sha"]
        existing.created_at = run["created_at"]
        existing.updated_at = run["updated_at"]
        existing.html_url = run["html_url"]

        print(f"Updated workflow run: {run['id']}")

    else:
        # Create new workflow run
        workflow_db = WorkflowRunModel(
            id=run["id"],
            name=run["name"],
            run_number=run["run_number"],
            branch=run["head_branch"],
            status=run["status"],
            conclusion=run["conclusion"],
            commit_sha=run["head_sha"],
            created_at=run["created_at"],
            updated_at=run["updated_at"],
            html_url=run["html_url"],
        )

        db.add(workflow_db)

        print(f"Inserted workflow run: {run['id']}")

    db.commit()

    return {
        "message": "Workflow run saved",
        "workflow_run_id": run["id"],
        "status": run["status"],
        "conclusion": run["conclusion"],
    }