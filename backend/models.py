from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Union
from datetime import datetime
from enum import Enum

# Enums
class UserRole(str, Enum):
    ADMIN = "admin"
    BD = "bd"

class LeadStatus(str, Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"

class BDStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"

# User Models
class UserBase(BaseModel):
    name: str
    email: EmailStr
    phone: str
    role: UserRole

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    phone: str
    role: UserRole
    supported_languages: List[str] = []
    # Optional call transcript sample — AI detects languages and merges into supported_languages
    transcription: Optional[str] = None
    transcriptionData: Optional[dict] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    supported_languages: Optional[List[str]] = None

class PasswordReset(BaseModel):
    current_password: str
    new_password: str

class User(UserBase):
    id: str
    role: UserRole
    supported_languages: List[str]
    status: BDStatus = BDStatus.ACTIVE
    created_at: datetime
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: dict

# Lead Models
class TranscriptionData(BaseModel):
    callId: str = ""
    source: str = "transcript_content"
    transcript: str


class LeadBase(BaseModel):
    name: str
    email: EmailStr
    phone: str
    preferred_language: Optional[str] = None


class LeadCreate(LeadBase):
    # Prefer language and/or call transcription (at least one required)
    transcription: Optional[str] = None
    transcriptionData: Optional[Union[TranscriptionData, dict]] = None


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    preferred_language: Optional[str] = None
    status: Optional[LeadStatus] = None
    transcription: Optional[str] = None
    transcriptionData: Optional[Union[TranscriptionData, dict]] = None


class Lead(LeadBase):
    id: str
    preferred_language: str
    assigned_bd: Optional[str]
    status: LeadStatus
    transcriptionData: Optional[dict] = None
    transcriptedLanguages: Optional[List[str]] = None
    created_at: datetime
    assigned_at: Optional[datetime]
    completed_at: Optional[datetime]
    class Config:
        from_attributes = True

# BD Profile Model
class BDProfile(BaseModel):
    bd_id: str
    name: str
    email: EmailStr
    phone: str
    supported_languages: List[str]
    active_lead_count: int = 0
    status: BDStatus = BDStatus.ACTIVE
    availability: bool = True

class BDCreate(BaseModel):
    name: str
    email: EmailStr
    phone: str
    supported_languages: List[str] = []

class BDUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    supported_languages: Optional[List[str]] = None
    status: Optional[BDStatus] = None
    availability: Optional[bool] = None

# Bulk Upload Models
class BulkUserCreate(BaseModel):
    users: List[UserCreate]

class BulkLeadCreate(BaseModel):
    leads: List[LeadCreate]

class UploadResult(BaseModel):
    success_count: int
    failed_count: int
    successful: List[dict]
    failed: List[dict]

# Routing History
class RoutingHistory(BaseModel):
    id: str
    lead_id: str
    lead_name: str
    previous_bd: Optional[str]
    new_bd: str
    reason: str
    routing_type: str
    timestamp: datetime

# Dashboard Stats
class DashboardStats(BaseModel):
    total_bds: int
    total_leads: int
    active_leads: int
    pending_leads: int
    completed_leads: int

class BDWorkload(BaseModel):
    bd_id: str
    name: str
    supported_languages: List[str]
    active_lead_count: int
    available_capacity: int
    availability_status: str
