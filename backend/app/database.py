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


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def check_db() -> bool:
    from sqlalchemy import text

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()