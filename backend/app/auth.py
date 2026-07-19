import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Header, HTTPException
from pydantic import BaseModel


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


class AuthenticatedUser(BaseModel):
    id: str
    email: str | None = None
    role: str | None = None


def require_authenticated_user(
    authorization: str | None = Header(default=None),
) -> AuthenticatedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv(
        "SUPABASE_ANON_KEY"
    )
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=500, detail="Supabase auth is not configured")

    request = urllib.request.Request(
        f"{supabase_url}/auth/v1/user",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {token}",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload: dict[str, Any] = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            raise HTTPException(status_code=401, detail="Invalid or expired session") from exc
        raise HTTPException(status_code=502, detail="Supabase auth check failed") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Supabase auth check failed") from exc

    user_id = payload.get("id")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    email = payload.get("email")
    role = payload.get("role")
    return AuthenticatedUser(
        id=user_id,
        email=email if isinstance(email, str) else None,
        role=role if isinstance(role, str) else None,
    )
