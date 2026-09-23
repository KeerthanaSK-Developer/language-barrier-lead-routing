from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from bson import ObjectId
from datetime import datetime
from database import leads_collection, bds_collection, routing_history_collection, pending_leads_collection, users_collection, serialize_doc
from auth import get_current_admin_user
from config import MAX_ACTIVE_LEADS_PER_BD
from services.routing_service import LeadRoutingService, lead_routing_service
from services.password_service import password_service
from services.email_service import email_service
from services.ai_service import resolve_languages_with_transcript
from models import DashboardStats, BDWorkload
from utils.pagination import get_pagination, skip_limit, paginated
from passlib.context import CryptContext
from typing import Tuple
import logging
import re

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = logging.getLogger(__name__)

@router.get("/dashboard", response_model=DashboardStats)
async def get_dashboard_stats(current_user: dict = Depends(get_current_admin_user)):
    """Get dashboard statistics."""
    total_bds = bds_collection.count_documents({"status": "active"})
    total_leads = leads_collection.count_documents({})
    active_leads = leads_collection.count_documents({"status": {"$in": ["assigned", "in_progress"]}})
    # Align with Pending page: unassigned new/pending leads
    pending_leads = leads_collection.count_documents({
        "$or": [{"assigned_bd": None}, {"assigned_bd": {"$exists": False}}],
        "status": {"$in": ["new", "pending"]}
    })
    completed_leads = leads_collection.count_documents({"status": "completed"})
    
    return {
        "total_bds": total_bds,
        "total_leads": total_leads,
        "active_leads": active_leads,
        "pending_leads": pending_leads,
        "completed_leads": completed_leads
    }

@router.get("/routing-history")
async def get_routing_history(current_user: dict = Depends(get_current_admin_user)):
    """Get routing history."""
    history = []
    
    for event in routing_history_collection.find().sort("timestamp", -1).limit(50):
        event = serialize_doc(event)
        
        # Get BD names
        if event.get("previous_bd"):
            prev_bd = bds_collection.find_one({"bd_id": event["previous_bd"]}, {"_id": 0})
            if not prev_bd:
                user = users_collection.find_one({"email": event["previous_bd"]}, {"_id": 0})
                event["previous_bd_name"] = user["name"] if user else "Unknown"
            else:
                event["previous_bd_name"] = prev_bd["name"]
        else:
            event["previous_bd_name"] = None
        
        new_bd = bds_collection.find_one({"bd_id": event["new_bd"]}, {"_id": 0})
        event["new_bd_name"] = new_bd["name"] if new_bd else "Unknown"
        
        history.append(event)
    
    return history

@router.get("/pending-leads")
async def get_pending_leads(
    current_user: dict = Depends(get_current_admin_user),
    pagination: Tuple[int, int] = Depends(get_pagination),
):
    """Get pending/unassigned leads (queue + unassigned leads), paginated."""
    page, page_size = pagination
    skip, limit = skip_limit(page, page_size)
    pending = []
    seen_lead_ids = set()

    # From pending queue
    for item in pending_leads_collection.find().sort("created_at", 1):
        item = serialize_doc(item)
        lead_id = item.get("lead_id") or item["id"]
        if lead_id in seen_lead_ids:
            continue
        seen_lead_ids.add(lead_id)

        # Prefer live lead document for latest fields
        lead_doc = None
        try:
            lead_doc = serialize_doc(leads_collection.find_one({"_id": ObjectId(lead_id)}))
        except Exception:
            lead_doc = None

        pending.append({
            "id": lead_id,
            "lead_id": lead_id,
            "name": (lead_doc or {}).get("name") or item.get("name") or item.get("lead_name", ""),
            "lead_name": (lead_doc or {}).get("name") or item.get("lead_name", ""),
            "email": (lead_doc or {}).get("email") or item.get("email", ""),
            "phone": (lead_doc or {}).get("phone") or item.get("phone", ""),
            "preferred_language": (lead_doc or {}).get("preferred_language") or item.get("preferred_language"),
            "status": (lead_doc or {}).get("status") or item.get("status", "pending"),
            "created_at": (lead_doc or {}).get("created_at") or item.get("created_at"),
        })

    # Also include leads stuck as new/pending without assignment
    for lead in leads_collection.find({
        "$or": [{"assigned_bd": None}, {"assigned_bd": {"$exists": False}}],
        "status": {"$in": ["new", "pending"]}
    }).sort("created_at", 1):
        lead = serialize_doc(lead)
        if lead["id"] in seen_lead_ids:
            continue
        seen_lead_ids.add(lead["id"])
        pending.append({
            "id": lead["id"],
            "lead_id": lead["id"],
            "name": lead.get("name") or lead.get("lead_name", ""),
            "lead_name": lead.get("name") or lead.get("lead_name", ""),
            "email": lead.get("email", ""),
            "phone": lead.get("phone", ""),
            "preferred_language": lead.get("preferred_language"),
            "status": lead.get("status", "pending"),
            "created_at": lead.get("created_at"),
        })

    total = len(pending)
    page_items = pending[skip:skip + limit]
    return paginated(page_items, total, page, page_size)

@router.get("/bd-workload")
async def get_bd_workload(current_user: dict = Depends(get_current_admin_user)):
    """Get BD workload overview."""
    workloads = []
    
    for bd in bds_collection.find({}, {"_id": 0}):
        active_count = leads_collection.count_documents({
            "assigned_bd": bd["bd_id"],
            "status": {"$in": ["assigned", "in_progress"]}
        })
        
        available_capacity = max(0, MAX_ACTIVE_LEADS_PER_BD - active_count)
        
        workloads.append({
            "bd_id": bd["bd_id"],
            "name": bd["name"],
            "supported_languages": bd["supported_languages"],
            "active_lead_count": active_count,
            "available_capacity": available_capacity,
            "availability_status": LeadRoutingService.get_bd_availability_status(active_count)
        })
    
    return workloads

@router.post("/bulk-users-upload")
async def bulk_upload_users(
    payload: dict,
    current_user: dict = Depends(get_current_admin_user)
):
    """
    Bulk upload users from rows (no CSV header).
    Expected: name, email, phone, role, supported_languages, transcription(optional)
    For BD: languages and/or transcription required.
    Languages use | separator, e.g. Tamil|English
    """
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise HTTPException(
            status_code=400,
            detail="Provide rows: [[name, email, phone, role, languages, transcription], ...]",
        )

    successful = []
    failed = []

    for index, row in enumerate(rows, start=1):
        try:
            if not isinstance(row, (list, tuple)) or len(row) < 4:
                raise ValueError(
                    "Expected columns: name, email, phone, role, supported_languages, transcription"
                )

            name = str(row[0]).strip()
            email = str(row[1]).strip().lower()
            phone = str(row[2]).strip()
            role = str(row[3]).strip().lower()
            languages_raw = str(row[4]).strip() if len(row) > 4 else ""
            transcription = str(row[5]).strip() if len(row) > 5 else ""

            if not name:
                raise ValueError("Name is required")
            if "@" not in email or "." not in email:
                raise ValueError("Invalid email")
            if not phone or len(re.sub(r"\D", "", phone)) < 7:
                raise ValueError("Invalid contact number")
            if role not in ("admin", "bd"):
                raise ValueError("Role must be admin or bd")

            supported_languages = [l.strip() for l in languages_raw.replace(";", "|").split("|") if l.strip()]
            if role == "bd":
                resolved = resolve_languages_with_transcript(
                    explicit_languages=supported_languages,
                    transcription=transcription or None,
                    require_any=True,
                )
                supported_languages = resolved["languages"]
                if not supported_languages:
                    raise ValueError("BD users require language and/or transcription")

            existing = users_collection.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
            if existing:
                existing_role = (existing.get("role") or "user").upper()
                raise ValueError(f"Email already exists as {existing_role}")

            if bds_collection.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}):
                raise ValueError("Email already exists as BD")

            password = password_service.generate_password(name, phone)
            hashed_password = pwd_context.hash(password)

            user_dict = {
                "name": name,
                "email": email,
                "phone": phone,
                "role": role,
                "password": hashed_password,
                "supported_languages": supported_languages if role == "bd" else [],
                "status": "active",
                "created_at": datetime.utcnow()
            }

            result = users_collection.insert_one(user_dict)
            user_id = str(result.inserted_id)

            if role == "bd":
                bds_collection.insert_one({
                    "bd_id": user_id,
                    "name": name,
                    "email": email,
                    "phone": phone,
                    "supported_languages": supported_languages,
                    "active_lead_count": 0,
                    "status": "active",
                    "availability": True
                })
                assigned_leads = lead_routing_service.fill_capacity_for_bd(user_id)
            else:
                assigned_leads = []

            email_queued = email_service.send_user_credentials(
                user_name=name,
                user_email=email,
                initial_password=password
            )

            reason = "Created" + (" (email queued)" if email_queued else " (email skipped)")
            if role == "bd" and assigned_leads:
                reason += f" · assigned {len(assigned_leads)} pending lead(s)"

            successful.append({
                "row": index,
                "name": name,
                "email": email,
                "phone": phone,
                "role": role,
                "supported_languages": "|".join(supported_languages),
                "status": "created",
                "reason": reason,
                "assigned_leads_count": len(assigned_leads),
            })

        except Exception as e:
            vals = row if isinstance(row, (list, tuple)) else []
            failed.append({
                "row": index,
                "name": str(vals[0]).strip() if len(vals) > 0 else "",
                "email": str(vals[1]).strip() if len(vals) > 1 else "",
                "phone": str(vals[2]).strip() if len(vals) > 2 else "",
                "role": str(vals[3]).strip() if len(vals) > 3 else "",
                "supported_languages": str(vals[4]).strip() if len(vals) > 4 else "",
                "status": "failed",
                "reason": str(e),
            })

    return {
        "success_count": len(successful),
        "failed_count": len(failed),
        "successful": successful,
        "failed": failed,
        "results": successful + failed,
    }

@router.post("/check-pending")
async def check_pending_assignments(current_user: dict = Depends(get_current_admin_user)):
    """Manually trigger pending assignment + reclaim mismatched language leads."""
    results = []
    for bd in bds_collection.find({"status": "active"}, {"_id": 0, "bd_id": 1}):
        results.extend(lead_routing_service.fill_capacity_for_bd(bd["bd_id"]))

    assignments = [a for a in results if a.get("type") != "reclaim"]
    reclaims = [a for a in results if a.get("type") == "reclaim"]

    return {
        "message": f"Processed {len(assignments)} pending and {len(reclaims)} reclaimed leads",
        "assignments": assignments,
        "reclaims": reclaims,
    }
