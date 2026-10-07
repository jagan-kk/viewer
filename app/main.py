from fastapi import FastAPI
from app.schemas.workflow import WorkflowRun
from app.services.github import GitHubClient
from app import database

app = FastAPI(title="CI/CD Release Dashboard")

github = GitHubClient()


@app.get("/")
def root():
    return {"message": "CI/CD Dashboard API is running"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/workflows", response_model=list[WorkflowRun])
async def get_workflows():
    data = await github.get_workflow_runs(
        owner="jagan-kk",
        repo="viewer_test",
    )

    workflows = []

    for run in data["workflow_runs"]:
        workflow = WorkflowRun(
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

    return workflows