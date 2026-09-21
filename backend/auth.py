from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from config import SECRET_KEY, ALGORITHM
from database import users_collection, serialize_doc
import re

security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get current authenticated user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = serialize_doc(users_collection.find_one({
        "email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}
    }))
    if user is None:
        raise credentials_exception
    
    if user.get("status") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    return {
        "id": user["id"],
        "email": user["email"],
        "role": user["role"],
        "name": user["name"],
        "phone": user["phone"],
        "supported_languages": user.get("supported_languages", [])
    }

async def get_current_admin_user(current_user: dict = Depends(get_current_user)):
    """Ensure user is admin."""
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin users can perform this action"
        )
    return current_user

async def get_current_bd_user(current_user: dict = Depends(get_current_user)):
    """Ensure user is BD."""
    if current_user["role"] != "bd":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only BD users can perform this action"
        )
    return current_user
