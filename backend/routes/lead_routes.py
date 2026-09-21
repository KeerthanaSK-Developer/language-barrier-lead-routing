from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from datetime import datetime
from database import leads_collection, bds_collection, pending_leads_collection, serialize_doc
from models import LeadCreate, LeadUpdate
from auth import get_current_user, get_current_admin_user, get_current_bd_user
from services.routing_service import lead_routing_service, _bd_speaks
from utils.pagination import get_pagination, skip_limit, paginated
from pydantic import ValidationError
from typing import List, Tuple
import re
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[\d+\-\s()]{7,20}$")


def _validate_lead_fields(name: str, email: str, phone: str, preferred_language: str):
    if not name or not name.strip():
        raise ValueError("Name is required")
    if not email or not EMAIL_RE.match(email.strip()):
        raise ValueError("Invalid email")
    if not phone or not PHONE_RE.match(phone.strip()):
        raise ValueError("Invalid contact number")
    if not preferred_language or not preferred_language.strip():
        raise ValueError("Language is required")


@router.get("/")
async def get_leads(
    current_user: dict = Depends(get_current_admin_user),
    pagination: Tuple[int, int] = Depends(get_pagination),
):
    """Get leads (Admin only) with pagination."""
    page, page_size = pagination
    skip, limit = skip_limit(page, page_size)
    total = leads_collection.count_documents({})
    leads = []
    for lead in leads_collection.find().sort("created_at", -1).skip(skip).limit(limit):
        lead = serialize_doc(lead)
        # Back-compat for older docs
        if "name" not in lead and lead.get("lead_name"):
            lead["name"] = lead["lead_name"]

        if lead.get("assigned_bd"):
            bd = bds_collection.find_one({"bd_id": lead["assigned_bd"]}, {"_id": 0})
            lead["assigned_bd_name"] = bd["name"] if bd else "Unknown"
        else:
            lead["assigned_bd_name"] = None

        leads.append(lead)
    return paginated(leads, total, page, page_size)


@router.get("/my-leads")
async def get_my_leads(
    current_user: dict = Depends(get_current_bd_user),
    pagination: Tuple[int, int] = Depends(get_pagination),
):
    """Get active leads assigned to current BD (paginated)."""
    page, page_size = pagination
    skip, limit = skip_limit(page, page_size)
    bd_id = current_user["id"]
    query = {"assigned_bd": bd_id, "status": {"$ne": "completed"}}
    total = leads_collection.count_documents(query)

    leads = []
    for lead in leads_collection.find(query).sort("assigned_at", -1).skip(skip).limit(limit):
        lead = serialize_doc(lead)
        if "name" not in lead and lead.get("lead_name"):
            lead["name"] = lead["lead_name"]
        leads.append(lead)

    return paginated(leads, total, page, page_size)

@router.post("/")
async def create_lead(
    lead: LeadCreate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Create single lead and auto-route."""
    try:
        _validate_lead_fields(lead.name, lead.email, lead.phone, lead.preferred_language)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Duplicate email check (case-insensitive)
    email_norm = lead.email.lower().strip()
    if leads_collection.find_one({"email": {"$regex": f"^{re.escape(email_norm)}$", "$options": "i"}}):
        raise HTTPException(status_code=409, detail="Email already exists")

    lead_dict = lead.dict()
    lead_dict["name"] = lead_dict["name"].strip()
    lead_dict["email"] = email_norm
    lead_dict["phone"] = lead_dict["phone"].strip()
    lead_dict["preferred_language"] = lead_dict["preferred_language"].strip()
    lead_dict["status"] = "new"
    lead_dict["assigned_bd"] = None
    lead_dict["created_at"] = datetime.utcnow()
    lead_dict["assigned_at"] = None
    lead_dict["completed_at"] = None
    
    result = leads_collection.insert_one(lead_dict)
    lead_id = str(result.inserted_id)
    
    routing_result = lead_routing_service.route_new_lead(
        lead_id=lead_id,
        language=lead_dict["preferred_language"],
        lead_name=lead_dict["name"],
        lead_email=lead_dict["email"],
        lead_phone=lead_dict["phone"],
    )
    
    created_lead = serialize_doc(leads_collection.find_one({"_id": ObjectId(lead_id)}))
    
    if created_lead.get("assigned_bd"):
        bd = bds_collection.find_one({"bd_id": created_lead["assigned_bd"]}, {"_id": 0})
        created_lead["assigned_bd_name"] = bd["name"] if bd else "Unknown"
    else:
        created_lead["assigned_bd_name"] = None
    
    return {
        "lead": created_lead,
        "routing": routing_result
    }

@router.post("/bulk-upload")
async def bulk_upload_leads(
    payload: dict,
    current_user: dict = Depends(get_current_admin_user)
):
    """
    Bulk upload leads from rows (no CSV header).
    Expected row order: name, email, phone, preferred_language
    """
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=400, detail="Provide rows: [[name, email, phone, language], ...]")

    successful = []
    failed = []

    for index, row in enumerate(rows, start=1):
        try:
            if not isinstance(row, (list, tuple)) or len(row) < 4:
                raise ValueError("Expected 4 columns: name, email, phone, preferred_language")

            name = str(row[0]).strip()
            email = str(row[1]).strip().lower()
            phone = str(row[2]).strip()
            preferred_language = str(row[3]).strip()

            _validate_lead_fields(name, email, phone, preferred_language)

            if leads_collection.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}):
                raise ValueError("Email already exists")

            lead_data = {
                "name": name,
                "email": email,
                "phone": phone,
                "preferred_language": preferred_language,
                "status": "new",
                "assigned_bd": None,
                "created_at": datetime.utcnow(),
                "assigned_at": None,
                "completed_at": None,
            }

            result = leads_collection.insert_one(lead_data)
            lead_id = str(result.inserted_id)

            routing_result = lead_routing_service.route_new_lead(
                lead_id=lead_id,
                language=preferred_language,
                lead_name=name,
                lead_email=email,
                lead_phone=phone,
            )

            successful.append({
                "row": index,
                "name": name,
                "email": email,
                "phone": phone,
                "preferred_language": preferred_language,
                "status": "created",
                "reason": routing_result.get("reason", "Created"),
                "routed": routing_result.get("routed", False),
            })
        except Exception as e:
            vals = row if isinstance(row, (list, tuple)) else []
            failed.append({
                "row": index,
                "name": str(vals[0]).strip() if len(vals) > 0 else "",
                "email": str(vals[1]).strip() if len(vals) > 1 else "",
                "phone": str(vals[2]).strip() if len(vals) > 2 else "",
                "preferred_language": str(vals[3]).strip() if len(vals) > 3 else "",
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

@router.post("/{lead_id}/complete")
async def complete_lead(
    lead_id: str,
    current_user: dict = Depends(get_current_bd_user)
):
    """BD completes a lead."""
    try:
        ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead id")

    lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if lead.get("assigned_bd") != current_user["id"]:
        raise HTTPException(
            status_code=403,
            detail="You are not assigned to this lead"
        )
    
    result = lead_routing_service.complete_lead(lead_id)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to complete lead"))
    
    return result

@router.post("/{lead_id}/manual-assign/{bd_id}")
async def manual_assign_lead(
    lead_id: str,
    bd_id: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Manually assign a lead to a BD (admin). Allows language mismatch; blocks if BD is at capacity."""
    try:
        ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead id")

    lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if lead.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Cannot assign a completed lead")

    bd = bds_collection.find_one({"bd_id": bd_id}, {"_id": 0})
    if not bd:
        raise HTTPException(status_code=404, detail="BD not found")

    if bd.get("status") != "active":
        raise HTTPException(status_code=400, detail="BD is not active")

    active_count = leads_collection.count_documents({
        "assigned_bd": bd_id,
        "status": {"$in": ["assigned", "in_progress"]}
    })
    from config import MAX_ACTIVE_LEADS_PER_BD
    if active_count >= MAX_ACTIVE_LEADS_PER_BD:
        raise HTTPException(
            status_code=400,
            detail=f"{bd['name']} is at full capacity ({MAX_ACTIVE_LEADS_PER_BD} active leads)"
        )

    # assign_lead_to_bd syncs both previous and new BD counts
    success = lead_routing_service.assign_lead_to_bd(lead_id, bd_id, auto=False)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to assign lead")

    language_match = _bd_speaks(bd, lead.get("preferred_language", ""))

    return {
        "message": f"Lead manually assigned to {bd['name']}",
        "lead_id": lead_id,
        "bd_id": bd_id,
        "bd_name": bd["name"],
        "language_match": language_match,
        "warning": None if language_match else f"{bd['name']} does not speak {lead.get('preferred_language')}",
    }

@router.put("/{lead_id}")
async def update_lead(
    lead_id: str,
    lead: LeadUpdate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Update lead."""
    update_data = {k: v for k, v in lead.dict().items() if v is not None}
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    update_data["updated_at"] = datetime.utcnow()
    
    leads_collection.update_one(
        {"_id": ObjectId(lead_id)},
        {"$set": update_data}
    )
    
    return serialize_doc(leads_collection.find_one({"_id": ObjectId(lead_id)}))

@router.delete("/{lead_id}")
async def delete_lead(
    lead_id: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Delete lead."""
    try:
        ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead id")

    lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    assigned_bd = lead.get("assigned_bd")
    was_active = lead.get("status") in ("assigned", "in_progress")

    result = leads_collection.delete_one({"_id": ObjectId(lead_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")

    pending_leads_collection.delete_many({"lead_id": lead_id})

    if assigned_bd and was_active:
        lead_routing_service._sync_active_count(assigned_bd)
    
    return {"message": "Lead deleted successfully"}
