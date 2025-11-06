from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Dict

from app.db.base import get_db
from app.models.user import User
from app.services.spotify_service import spotify_service
from app.core.security import create_access_token

router = APIRouter()


@router.get("/login")
async def spotify_login():
    """
    Initiate Spotify OAuth flow
    Redirects user to Spotify authorization page
    """
    auth_manager = spotify_service.get_auth_manager()
    auth_url = auth_manager.get_authorize_url()
    return {"auth_url": auth_url}


@router.get("/callback")
async def spotify_callback(code: str, db: Session = Depends(get_db)):
    """
    Handle Spotify OAuth callback
    Exchange code for access token and create/update user
    """
    try:
        auth_manager = spotify_service.get_auth_manager()
        token_info = auth_manager.get_access_token(code)

        if not token_info:
            raise HTTPException(status_code=400, detail="Failed to get access token")

        # Get user info from Spotify
        sp = spotify_service.get_client(token_info['access_token'])
        spotify_user = sp.current_user()

        # Create or update user in database
        user = db.query(User).filter(User.spotify_id == spotify_user['id']).first()

        if not user:
            user = User(
                spotify_id=spotify_user['id'],
                email=spotify_user.get('email'),
                display_name=spotify_user.get('display_name'),
                access_token=token_info['access_token'],
                refresh_token=token_info.get('refresh_token'),
                token_expires_at=datetime.utcnow() + timedelta(seconds=token_info['expires_in'])
            )
            db.add(user)
        else:
            user.access_token = token_info['access_token']
            user.refresh_token = token_info.get('refresh_token', user.refresh_token)
            user.token_expires_at = datetime.utcnow() + timedelta(seconds=token_info['expires_in'])

        db.commit()
        db.refresh(user)

        # Create JWT token for our app
        access_token = create_access_token(data={"user_id": user.id})

        # Redirect to frontend with token
        frontend_url = f"http://localhost:3000/auth/success?token={access_token}"
        return RedirectResponse(url=frontend_url)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Authentication failed: {str(e)}")


@router.get("/me")
async def get_current_user(db: Session = Depends(get_db)):
    """
    Get current user info
    TODO: Add JWT authentication dependency
    """
    # Placeholder - will add proper JWT auth
    return {"message": "User info endpoint"}


@router.post("/refresh")
async def refresh_spotify_token(db: Session = Depends(get_db)):
    """
    Refresh Spotify access token
    TODO: Add user authentication
    """
    return {"message": "Token refresh endpoint"}
