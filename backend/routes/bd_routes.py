from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from bson import ObjectId
from datetime import datetime
from database import bds_collection, leads_collection, routing_history_collection, serialize_doc
from models import BDCreate, BDUpdate
from auth import get_current_admin_user
from config import MAX_ACTIVE_LEADS_PER_BD
from services.routing_service import LeadRoutingService, lead_routing_service
from utils.pagination import get_pagination, skip_limit, paginated
from typing import Tuple
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/")
async def get_bds(
    current_user: dict = Depends(get_current_admin_user),
    pagination: Tuple[int, int] = Depends(get_pagination),
):
    """Get BDs with workload information (paginated)."""
    page, page_size = pagination
    skip, limit = skip_limit(page, page_size)
    total = bds_collection.count_documents({})
    bds = []
    for bd in bds_collection.find({}, {"_id": 0}).sort("name", 1).skip(skip).limit(limit):
        bd = serialize_doc(bd, id_field=None)
        bd["id"] = str(bd.get("bd_id", ""))
        
        # Get active leads count
        active_leads_count = leads_collection.count_documents({
            "assigned_bd": bd["bd_id"],
            "status": {"$in": ["assigned", "in_progress"]}
        })
        
        # Calculate availability status
        available_capacity = max(0, MAX_ACTIVE_LEADS_PER_BD - active_leads_count)
        bd["active_lead_count"] = active_leads_count
        bd["available_capacity"] = available_capacity
        bd["availability_status"] = LeadRoutingService.get_bd_availability_status(active_leads_count)
        
        # Get assigned leads
        assigned_leads = []
        for lead in leads_collection.find({"assigned_bd": bd["bd_id"]}):
            assigned_leads.append({
                "id": str(lead["_id"]),
                "lead_name": lead.get("name") or lead.get("lead_name", ""),
                "email": lead.get("email", ""),
                "phone": lead.get("phone", ""),
                "preferred_language": lead["preferred_language"],
                "status": lead["status"],
                "assigned_at": lead.get("assigned_at")
            })
        
        bd["assigned_leads"] = assigned_leads
        bds.append(bd)
    
    return paginated(bds, total, page, page_size)

@router.get("/{bd_id}")
async def get_bd_details(
    bd_id: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Get detailed information about a specific BD."""
    bd = bds_collection.find_one({"bd_id": bd_id}, {"_id": 0})
    
    if not bd:
        raise HTTPException(status_code=404, detail="BD not found")
    
    # Get active leads
    active_leads_count = leads_collection.count_documents({
        "assigned_bd": bd_id,
        "status": {"$in": ["assigned", "in_progress"]}
    })
    
    # Get all assigned leads
    assigned_leads = []
    for lead in leads_collection.find({"assigned_bd": bd_id}):
        assigned_leads.append({
            "id": str(lead["_id"]),
            "lead_name": lead.get("name") or lead.get("lead_name", ""),
            "email": lead.get("email", ""),
            "phone": lead.get("phone", ""),
            "preferred_language": lead["preferred_language"],
            "status": lead["status"],
            "assigned_at": lead.get("assigned_at"),
            "completed_at": lead.get("completed_at")
        })
    
    available_capacity = max(0, MAX_ACTIVE_LEADS_PER_BD - active_leads_count)
    
    return {
        "id": bd_id,
        "name": bd["name"],
        "email": bd["email"],
        "phone": bd["phone"],
        "supported_languages": bd["supported_languages"],
        "active_lead_count": active_leads_count,
        "available_capacity": available_capacity,
        "availability_status": LeadRoutingService.get_bd_availability_status(active_leads_count),
        "status": bd.get("status", "active"),
        "assigned_leads": assigned_leads
    }

@router.put("/{bd_id}")
async def update_bd(
    bd_id: str,
    bd: BDUpdate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Update BD information."""
    update_data = {k: v for k, v in bd.dict().items() if v is not None}
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = bds_collection.update_one(
        {"bd_id": bd_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="BD not found")
    
    updated_bd = serialize_doc(
        bds_collection.find_one({"bd_id": bd_id}, {"_id": 0}),
        id_field=None
    )
    updated_bd["id"] = bd_id
    
    return updated_bd

@router.put("/{bd_id}/toggle-availability")
async def toggle_bd_availability(
    bd_id: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Toggle BD availability."""
    bd = bds_collection.find_one({"bd_id": bd_id}, {"_id": 0})
    
    if not bd:
        raise HTTPException(status_code=404, detail="BD not found")
    
    new_availability = not bd.get("availability", True)
    
    bds_collection.update_one(
        {"bd_id": bd_id},
        {"$set": {"availability": new_availability}}
    )
    
    return {
        "message": f"BD availability set to {new_availability}",
        "availability": new_availability
    }
