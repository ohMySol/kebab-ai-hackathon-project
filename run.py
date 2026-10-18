"""Local launch. Put provider keys in .env; never commit that file."""
import os
from dotenv import load_dotenv
import uvicorn

if __name__ == "__main__":
    load_dotenv()
    password = os.getenv("APP_PASSWORD", "").strip()
    if not password or password.startswith("__"):
        raise SystemExit("Set APP_PASSWORD in .env (copy env.example to .env) before starting.")
    uvicorn.run("app.main:app", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
