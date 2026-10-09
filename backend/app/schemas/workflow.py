from datetime import datetime
from pydantic import BaseModel


class WorkflowRun(BaseModel):
    id: int
    name: str
    run_number: int
    branch: str
    status: str
    conclusion: str | None
    commit_sha: str
    created_at: datetime
    updated_at: datetime
    html_url: str
    repository: str | None = None


class RepositoryCreate(BaseModel):
    owner: str
    name: str | None = None
    repo: str | None = None


class Repository(BaseModel):
    id: int
    owner: str
    name: str
    full_name: str