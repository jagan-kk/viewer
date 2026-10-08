from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    run_number: Mapped[int] = mapped_column(Integer)
    branch: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    conclusion: Mapped[str | None] = mapped_column(String, nullable=True)
    commit_sha: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)
    html_url: Mapped[str] = mapped_column(String)