from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

from app.db.base import get_db
from app.models.user import User
from app.core.security import create_access_token

router = APIRouter()


@router.get("/login")
async def local_login(db: Session = Depends(get_db)):
    """
    Local login — creates a default user for self-hosted streaming.
    No Spotify OAuth required.
    """
    try:
        default_email = "local@auralflow.local"
        user = db.query(User).filter(User.email == default_email).first()

        if not user:
            user = User(
                email=default_email,
                display_name="Local Audiophile",
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        # Create JWT token
        access_token = create_access_token(data={"user_id": user.id})

        # Redirect to frontend
        frontend_url = f"http://localhost:3000/auth/success?token={access_token}"
        return RedirectResponse(url=frontend_url)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Authentication failed: {str(e)}")


@router.get("/me")
async def get_current_user(db: Session = Depends(get_db)):
    """
    Get current user info.
    TODO: Add proper JWT authentication dependency.
    """
    default_email = "local@auralflow.local"
    user = db.query(User).filter(User.email == default_email).first()

    if user:
        return {
            "id": user.id,
            "display_name": user.display_name,
            "email": user.email,
        }
    return {"message": "No user logged in"}
