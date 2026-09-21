from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from database import users_collection, bds_collection, serialize_doc
from models import UserLogin, Token, UserCreate, PasswordReset
from auth import get_current_user, get_current_admin_user
from services.password_service import password_service
from services.email_service import email_service
from services.routing_service import lead_routing_service
from bson import ObjectId
import logging
import re

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = logging.getLogger(__name__)

def create_access_token(data: dict, expires_delta: timedelta = None):
    """Create JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@router.post("/login", response_model=Token)
async def login(user_data: UserLogin):
    """User login."""
    email = user_data.email.lower().strip()
    user = serialize_doc(users_collection.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}))
    
    if not user or not pwd_context.verify(user_data.password, user["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if user.get("status") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Please contact administrator."
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["email"]}, 
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "role": user["role"],
            "name": user["name"],
            "phone": user["phone"],
            "supported_languages": user.get("supported_languages", [])
        }
    }

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user info."""
    return current_user

@router.post("/create", status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreate, 
    current_user: dict = Depends(get_current_admin_user)
):
    """Admin creates new user (Admin/BD). Email must be unique across both roles."""
    email = user_data.email.lower().strip()

    existing = users_collection.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    if not existing:
        # Also block if email is already on a BD profile
        existing_bd = bds_collection.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
        if existing_bd:
            existing = {"role": "bd", "email": existing_bd.get("email")}

    if existing:
        existing_role = (existing.get("role") or "user").upper()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Email already exists as {existing_role}"
        )
    
    # Generate password
    if user_data.role.value == "bd" and not user_data.supported_languages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="BD users require at least one supported language"
        )

    password = password_service.generate_password(user_data.name, user_data.phone)
    hashed_password = pwd_context.hash(password)
    
    user_dict = {
        "name": user_data.name,
        "email": email,
        "phone": user_data.phone,
        "role": user_data.role.value,
        "password": hashed_password,
        "supported_languages": user_data.supported_languages,
        "status": "active",
        "created_at": datetime.utcnow()
    }
    
    result = users_collection.insert_one(user_dict)
    user_id = str(result.inserted_id)
    
    # If BD, create BD profile then auto-assign matching pending leads
    assigned_leads = []
    if user_data.role.value == "bd":
        bds_collection.insert_one({
            "bd_id": user_id,
            "name": user_data.name,
            "email": email,
            "phone": user_data.phone,
            "supported_languages": user_data.supported_languages,
            "active_lead_count": 0,
            "status": "active",
            "availability": True
        })
        # Assign pending / reclaim mismatched leads that match this BD's languages
        assigned_leads = lead_routing_service.fill_capacity_for_bd(user_id)
    
    # Send email with credentials
    try:
        email_service.send_user_credentials(
            user_name=user_data.name,
            user_email=email,
            initial_password=password
        )
        email_sent = True
    except Exception as e:
        logger.error(f"Failed to send email: {str(e)}")
        email_sent = False
    
    return {
        "message": "User created successfully",
        "user_id": user_id,
        "name": user_data.name,
        "email": email,
        "initial_password": password,  # Remove in production
        "email_sent": email_sent,
        "assigned_leads_count": len(assigned_leads),
        "assigned_leads": assigned_leads,
    }

@router.put("/reset-password")
async def reset_password(
    password_data: PasswordReset,
    current_user: dict = Depends(get_current_user)
):
    """User resets their password."""
    user = users_collection.find_one({"email": current_user["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if not pwd_context.verify(password_data.current_password, user["password"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    hashed_new_password = pwd_context.hash(password_data.new_password)
    
    users_collection.update_one(
        {"email": current_user["email"]},
        {"$set": {"password": hashed_new_password}}
    )
    
    return {"message": "Password updated successfully"}

@router.get("/list")
async def list_users(current_user: dict = Depends(get_current_admin_user)):
    """List all users (Admin only)."""
    users = []
    for user in users_collection.find():
        user = serialize_doc(user)
        users.append({
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "phone": user["phone"],
            "role": user["role"],
            "supported_languages": user.get("supported_languages", []),
            "status": user["status"],
            "created_at": user["created_at"]
        })
    return users
