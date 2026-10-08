from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.workflow import Base

DATABASE_URL = "postgresql+psycopg://postgres:postgres@localhost:5432/cicd_dashboard"

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)

Base.metadata.create_all(bind=engine)