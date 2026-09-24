from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from datetime import datetime
from database import leads_collection, bds_collection, pending_leads_collection, call_sessions_collection, serialize_doc
from models import LeadCreate, LeadUpdate, ReassignRequest
from auth import get_current_user, get_current_admin_user, get_current_bd_user
from services.routing_service import lead_routing_service, _bd_speaks
from services.ai_service import normalize_language_name, merge_languages
from utils.pagination import get_pagination, skip_limit, paginated
from typing import List, Tuple, Optional
from config import MAX_ACTIVE_LEADS_PER_BD
import re
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[\d+\-\s()]{7,20}$")


def _validate_lead_identity(name: str, email: str, phone: str):
    if not name or not name.strip():
        raise ValueError("Name is required")
    if not email or not EMAIL_RE.match(email.strip()):
        raise ValueError("Invalid email")
    if not phone or not PHONE_RE.match(phone.strip()):
        raise ValueError("Invalid contact number")


def _normalize_optional_language(raw: Optional[str]) -> Optional[str]:
    name = normalize_language_name((raw or "").strip())
    return name or None


def _has_real_processed_call(lead: dict) -> bool:
    """True only after a Classify recording was processed into lead insights.

    Stub last_call_insights (e.g. only languages_detected from an old edit) do NOT count —
    that previously let preferred leak into Call language with no call.
    """
    if lead.get("last_call_session_id"):
        return True
    insights = lead.get("last_call_insights")
    if isinstance(insights, dict) and insights.get("session_id"):
        return True
    return False


def _lead_match_languages(lead: dict) -> List[str]:
    call_langs = (
        lead.get("callLanguages") or lead.get("transcriptedLanguages") or []
        if _has_real_processed_call(lead)
        else []
    )
    return merge_languages(
        [lead.get("preferred_language")] if lead.get("preferred_language") else [],
        call_langs,
    )


def _recording_urls_from_sessions(lead_id: str) -> list:
    urls = []
    seen = set()
    for sess in call_sessions_collection.find({"lead_id": lead_id}, {"recordings": 1}):
        for r in sess.get("recordings") or []:
            url = ""
            if isinstance(r, dict):
                url = str(r.get("url") or "").strip()
            elif isinstance(r, str):
                url = r.strip()
            if url and url not in seen:
                seen.add(url)
                urls.append(url)
    return urls


def _enrich_lead(lead: dict) -> dict:
    if "name" not in lead and lead.get("lead_name"):
        lead["name"] = lead["lead_name"]

    # Call language only after a real processed call — never mirror preferred beforehand.
    has_processed_call = _has_real_processed_call(lead)
    raw_call = lead.get("callLanguages") or lead.get("transcriptedLanguages") or []
    stub_insights = isinstance(lead.get("last_call_insights"), dict) and not has_processed_call
    if not has_processed_call:
        if raw_call or stub_insights or lead.get("call_join_probability") is not None:
            # Persist cleanup of preferred/pre-call / stub junk
            try:
                oid = lead.get("id") or lead.get("_id")
                if oid:
                    leads_collection.update_one(
                        {"_id": ObjectId(str(oid))},
                        {
                            "$set": {
                                "callLanguages": [],
                                "transcriptedLanguages": [],
                            },
                            "$unset": {
                                "last_call_insights": "",
                                "call_join_probability": "",
                                "call_interest_level": "",
                                "call_interested": "",
                                "last_call_session_id": "",
                            },
                        },
                    )
            except Exception:
                pass
        lead["callLanguages"] = []
        lead["transcriptedLanguages"] = []
        lead.pop("last_call_insights", None)
        lead.pop("call_join_probability", None)
        lead.pop("call_interest_level", None)
        lead.pop("call_interested", None)
        lead.pop("last_call_session_id", None)
    elif not lead.get("callLanguages") and lead.get("transcriptedLanguages"):
        # Back-compat: expose callLanguages from older transcriptedLanguages
        lead["callLanguages"] = lead.get("transcriptedLanguages")

    if lead.get("assigned_bd"):
        bd = bds_collection.find_one({"bd_id": lead["assigned_bd"]}, {"_id": 0})
        lead["assigned_bd_name"] = bd["name"] if bd else "Unknown"
    else:
        lead["assigned_bd_name"] = None
    # Backfill recording links from call sessions when missing on lead
    if not lead.get("call_recording_urls") and lead.get("id"):
        urls = _recording_urls_from_sessions(lead["id"])
        if urls:
            lead["call_recording_urls"] = urls
            lead["call_recording_count"] = len(urls)
            try:
                leads_collection.update_one(
                    {"_id": ObjectId(lead["id"])},
                    {"$set": {
                        "call_recording_urls": urls,
                        "call_recording_count": len(urls),
                    }},
                )
            except Exception:
                pass
    elif lead.get("call_recording_urls") and lead.get("call_recording_count") is None:
        lead["call_recording_count"] = len(lead["call_recording_urls"])
    return lead


def _assign_with_capacity_check(lead_id: str, bd_id: str, *, clear_reassign: bool = False) -> dict:
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
        "status": {"$in": ["assigned", "in_progress"]},
    })
    # If reassigning to same BD somehow, don't double-count; for different BD check capacity
    if lead.get("assigned_bd") != bd_id and active_count >= MAX_ACTIVE_LEADS_PER_BD:
        raise HTTPException(
            status_code=400,
            detail=f"{bd['name']} is at full capacity ({MAX_ACTIVE_LEADS_PER_BD} active leads)",
        )

    success = lead_routing_service.assign_lead_to_bd(lead_id, bd_id, auto=False)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to assign lead")

    if clear_reassign:
        leads_collection.update_one(
            {"_id": ObjectId(lead_id)},
            {"$set": {
                "reassign_requested": False,
                "reassign_reason": None,
                "reassign_source": None,
                "reassign_requested_at": None,
                "reassign_requested_by": None,
                "updated_at": datetime.utcnow(),
            }},
        )

    match_langs = _lead_match_languages(lead)
    language_match = any(_bd_speaks(bd, lang) for lang in match_langs) if match_langs else False

    return {
        "lead_id": lead_id,
        "bd_id": bd_id,
        "bd_name": bd["name"],
        "language_match": language_match,
        "warning": None if language_match or not match_langs else (
            f"{bd['name']} does not speak {', '.join(match_langs)}"
        ),
    }


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
        leads.append(_enrich_lead(serialize_doc(lead)))
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
        leads.append(_enrich_lead(serialize_doc(lead)))

    return paginated(leads, total, page, page_size)


@router.post("/")
async def create_lead(
    lead: LeadCreate,
    current_user: dict = Depends(get_current_admin_user),
):
    """Create lead without auto-routing. preferred_language optional."""
    try:
        _validate_lead_identity(lead.name, lead.email, lead.phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    preferred_language = _normalize_optional_language(lead.preferred_language)

    email_norm = lead.email.lower().strip()
    if leads_collection.find_one({"email": {"$regex": f"^{re.escape(email_norm)}$", "$options": "i"}}):
        raise HTTPException(status_code=409, detail="Email already exists")

    now = datetime.utcnow()
    lead_dict = {
        "name": lead.name.strip(),
        "email": email_norm,
        "phone": lead.phone.strip(),
        "preferred_language": preferred_language,
        "callLanguages": [],
        "transcriptedLanguages": [],
        "status": "pending",
        "assigned_bd": None,
        "reassign_requested": False,
        "reassign_reason": None,
        "reassign_source": None,
        "created_at": now,
        "assigned_at": None,
        "completed_at": None,
    }

    result = leads_collection.insert_one(lead_dict)
    lead_id = str(result.inserted_id)
    # Keep pending queue in sync for admin pending page (no auto-assign)
    pending_leads_collection.insert_one({
        "lead_id": lead_id,
        "name": lead_dict["name"],
        "email": lead_dict["email"],
        "phone": lead_dict["phone"],
        "preferred_language": preferred_language,
        "callLanguages": [],
        "status": "pending",
        "created_at": now,
    })

    created_lead = _enrich_lead(serialize_doc(leads_collection.find_one({"_id": ObjectId(lead_id)})))
    return {
        "lead": created_lead,
        "routing": {"routed": False, "reason": "Awaiting manual assignment"},
    }


@router.post("/bulk-upload")
async def bulk_upload_leads(
    payload: dict,
    current_user: dict = Depends(get_current_admin_user),
):
    """
    Bulk upload leads. Columns: name, email, phone, preferred_language (optional).
    No transcription. No auto-routing.
    """
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise HTTPException(
            status_code=400,
            detail="Provide rows: [[name, email, phone, preferred_language], ...]",
        )

    successful = []
    failed = []

    for index, row in enumerate(rows, start=1):
        try:
            if not isinstance(row, (list, tuple)) or len(row) < 3:
                raise ValueError("Expected columns: name, email, phone, preferred_language")

            name = str(row[0]).strip()
            email = str(row[1]).strip().lower()
            phone = str(row[2]).strip()
            preferred_language = _normalize_optional_language(
                str(row[3]).strip() if len(row) > 3 else ""
            )

            _validate_lead_identity(name, email, phone)

            if leads_collection.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}):
                raise ValueError("Email already exists")

            now = datetime.utcnow()
            lead_data = {
                "name": name,
                "email": email,
                "phone": phone,
                "preferred_language": preferred_language,
                "callLanguages": [],
                "transcriptedLanguages": [],
                "status": "pending",
                "assigned_bd": None,
                "reassign_requested": False,
                "reassign_reason": None,
                "reassign_source": None,
                "created_at": now,
                "assigned_at": None,
                "completed_at": None,
            }

            result = leads_collection.insert_one(lead_data)
            lead_id = str(result.inserted_id)
            pending_leads_collection.insert_one({
                "lead_id": lead_id,
                "name": name,
                "email": email,
                "phone": phone,
                "preferred_language": preferred_language,
                "callLanguages": [],
                "status": "pending",
                "created_at": now,
            })

            successful.append({
                "row": index,
                "name": name,
                "email": email,
                "phone": phone,
                "preferred_language": preferred_language or "",
                "status": "created",
                "reason": "Created — awaiting manual assignment",
                "routed": False,
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
    current_user: dict = Depends(get_current_bd_user),
):
    """BD completes a lead (no auto-fill of pending leads)."""
    try:
        ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead id")

    lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("assigned_bd") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You are not assigned to this lead")

    result = lead_routing_service.complete_lead(lead_id, auto_fill=False)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to complete lead"))
    return result


@router.post("/{lead_id}/manual-assign/{bd_id}")
async def manual_assign_lead(
    lead_id: str,
    bd_id: str,
    current_user: dict = Depends(get_current_admin_user),
):
    """Manually assign an unassigned (or any non-completed) lead to a BD."""
    try:
        ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead id")

    info = _assign_with_capacity_check(lead_id, bd_id, clear_reassign=True)
    pending_leads_collection.delete_many({"lead_id": lead_id})
    return {
        "message": f"Lead manually assigned to {info['bd_name']}",
        **info,
    }


@router.post("/{lead_id}/request-reassign")
async def request_reassign(
    lead_id: str,
    body: ReassignRequest,
    current_user: dict = Depends(get_current_bd_user),
):
    """BD requests reassignment — lead stays assigned; enables admin Reassign button."""
    try:
        ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead id")

    lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("assigned_bd") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You are not assigned to this lead")
    if lead.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Cannot reassign a completed lead")

    reason = (body.reason or "").strip() or "BD requested reassignment"
    now = datetime.utcnow()
    leads_collection.update_one(
        {"_id": ObjectId(lead_id)},
        {"$set": {
            "reassign_requested": True,
            "reassign_reason": reason,
            "reassign_source": "bd",
            "reassign_requested_at": now,
            "reassign_requested_by": current_user["id"],
            "updated_at": now,
        }},
    )
    return {
        "message": "Reassign request submitted — waiting for admin",
        "reassign_requested": True,
        "reassign_reason": reason,
        "reassign_source": "bd",
    }


@router.post("/{lead_id}/reassign/{bd_id}")
async def reassign_lead(
    lead_id: str,
    bd_id: str,
    current_user: dict = Depends(get_current_admin_user),
):
    """Admin reassigns a lead that has reassign_requested=true."""
    try:
        ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead id")

    lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not lead.get("reassign_requested"):
        raise HTTPException(
            status_code=400,
            detail="Reassign is only available when BD requested it or AI flagged an issue",
        )
    if not lead.get("assigned_bd"):
        raise HTTPException(status_code=400, detail="Lead is not assigned — use Assign instead")

    info = _assign_with_capacity_check(lead_id, bd_id, clear_reassign=True)
    return {
        "message": f"Lead reassigned to {info['bd_name']}",
        **info,
    }


@router.put("/{lead_id}")
async def update_lead(
    lead_id: str,
    lead: LeadUpdate,
    current_user: dict = Depends(get_current_admin_user),
):
    """Admin update lead. Preferred language: any free-text value.
    Call languages: only when the lead already has callLanguages from a call.
    """
    try:
        oid = ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead id")

    existing = leads_collection.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Lead not found")

    raw = lead.dict(exclude_unset=True)
    update_data: dict = {}

    if "preferred_language" in raw:
        # Free-text — no catalog check; empty clears. Never copy into callLanguages.
        update_data["preferred_language"] = _normalize_optional_language(
            raw.get("preferred_language")
        )
        # If no real call yet, keep call language empty (clears preferred-leak junk)
        if not _has_real_processed_call(existing):
            update_data["callLanguages"] = []
            update_data["transcriptedLanguages"] = []

    if "callLanguages" in raw:
        # Only after a real processed call
        if not _has_real_processed_call(existing):
            raise HTTPException(
                status_code=400,
                detail="Call language can only be edited after a call recording is processed",
            )
        existing_langs = (
            existing.get("callLanguages")
            or existing.get("transcriptedLanguages")
            or []
        )
        if not existing_langs:
            raise HTTPException(
                status_code=400,
                detail="Call language can only be edited when a value already exists from a processed call",
            )
        langs = merge_languages(raw.get("callLanguages") or [])
        if not langs:
            raise HTTPException(
                status_code=400,
                detail="Provide at least one call language",
            )
        update_data["callLanguages"] = langs
        update_data["transcriptedLanguages"] = langs
        insights = dict(existing.get("last_call_insights") or {})
        insights["languages_detected"] = langs
        update_data["last_call_insights"] = insights

    for key in ("name", "email", "phone", "status"):
        if key in raw and raw[key] is not None:
            update_data[key] = raw[key]

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updated_at"] = datetime.utcnow()
    leads_collection.update_one({"_id": oid}, {"$set": update_data})
    return _enrich_lead(serialize_doc(leads_collection.find_one({"_id": oid})))


@router.delete("/{lead_id}")
async def delete_lead(
    lead_id: str,
    current_user: dict = Depends(get_current_admin_user),
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
