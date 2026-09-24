from datetime import datetime
from bson import ObjectId
from database import leads_collection, bds_collection, pending_leads_collection, routing_history_collection
from config import MAX_ACTIVE_LEADS_PER_BD
from services.email_service import email_service
from typing import Optional, List, Dict, Any


def _norm_lang(language: str) -> str:
    return (language or "").strip().casefold()


def _bd_speaks(bd: Dict[str, Any], language: str) -> bool:
    target = _norm_lang(language)
    if not target:
        return False
    return any(_norm_lang(l) == target for l in (bd.get("supported_languages") or []))


def _bd_speaks_any(bd: Dict[str, Any], languages: List[str]) -> bool:
    return any(_bd_speaks(bd, lang) for lang in (languages or []) if _norm_lang(lang))


def _merge_lang_list(*groups: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for group in groups:
        for raw in group or []:
            name = (raw or "").strip()
            if not name:
                continue
            key = _norm_lang(name)
            if key in seen:
                continue
            seen.add(key)
            out.append(name)
    return out


def _languages_for_lead(lead: Dict[str, Any]) -> List[str]:
    """preferred_language + transcriptedLanguages (for routing / pending match)."""
    preferred = lead.get("preferred_language")
    transcripted = lead.get("transcriptedLanguages") or lead.get("transcripted_languages") or []
    return _merge_lang_list(
        [preferred] if preferred else [],
        list(transcripted) if isinstance(transcripted, list) else [],
    )


class LeadRoutingService:
    """Service for automatic lead routing logic."""
    
    @staticmethod
    def find_available_bd(language: str) -> Optional[Dict[str, Any]]:
        """Find the best available BD for a given language (case-insensitive)."""
        return LeadRoutingService.find_available_bd_for_languages([language] if language else [])

    @staticmethod
    def find_available_bd_for_languages(languages: List[str]) -> Optional[Dict[str, Any]]:
        """Find BD who speaks any of the languages, lowest live workload."""
        langs = _merge_lang_list(languages or [])
        if not langs:
            return None
        compatible_bds = [
            bd for bd in bds_collection.find({"status": "active", "availability": True})
            if _bd_speaks_any(bd, langs)
        ]
        
        available_bds = []
        for bd in compatible_bds:
            active = LeadRoutingService._live_active_count(bd["bd_id"])
            bd["_live_active"] = active
            if active < MAX_ACTIVE_LEADS_PER_BD:
                available_bds.append(bd)
        
        if not available_bds:
            return None
        
        return min(available_bds, key=lambda x: x.get("_live_active", 0))

    @staticmethod
    def _live_active_count(bd_id: str) -> int:
        return leads_collection.count_documents({
            "assigned_bd": bd_id,
            "status": {"$in": ["assigned", "in_progress"]}
        })

    @staticmethod
    def _sync_active_count(bd_id: str) -> int:
        count = LeadRoutingService._live_active_count(bd_id)
        bds_collection.update_one({"bd_id": bd_id}, {"$set": {"active_lead_count": count}})
        return count
    
    @staticmethod
    def assign_lead_to_bd(lead_id: str, bd_id: str, auto: bool = True, reason: str = None) -> bool:
        """Assign (or reassign) a lead to a BD. Handles previous-BD count correctly."""
        try:
            lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
            if not lead:
                return False
            
            bd = bds_collection.find_one({"bd_id": bd_id})
            if not bd:
                return False
            
            previous_bd = lead.get("assigned_bd")
            was_active = lead.get("status") in ("assigned", "in_progress") and previous_bd

            # Same BD — nothing to do
            if previous_bd == bd_id and was_active:
                return True
            
            now = datetime.utcnow()
            leads_collection.update_one(
                {"_id": ObjectId(lead_id)},
                {
                    "$set": {
                        "assigned_bd": bd_id,
                        "status": "assigned",
                        "assigned_at": now
                    }
                }
            )

            # Decrement previous BD if they held this active lead
            if was_active and previous_bd and previous_bd != bd_id:
                LeadRoutingService._sync_active_count(previous_bd)

            # Sync new BD count
            LeadRoutingService._sync_active_count(bd_id)

            pending_leads_collection.delete_many({"lead_id": lead_id})

            if reason is None:
                if not auto:
                    reason = "Manual assignment"
                elif previous_bd:
                    reason = "Reassignment"
                else:
                    reason = "New lead assignment"
            
            routing_history_collection.insert_one({
                "lead_id": lead_id,
                "lead_name": lead.get("name") or lead.get("lead_name", ""),
                "previous_bd": previous_bd,
                "new_bd": bd_id,
                "reason": reason,
                "routing_type": "automatic" if auto else "manual",
                "timestamp": now
            })
            
            email_service.send_lead_assignment_notification(
                bd_name=bd["name"],
                bd_email=bd["email"],
                lead_name=lead.get("name") or lead.get("lead_name", ""),
                lead_email=lead.get("email", ""),
                lead_phone=lead.get("phone", ""),
                language=lead["preferred_language"],
                assigned_at=now.strftime("%Y-%m-%d %H:%M:%S")
            )
            
            return True
        except Exception as e:
            print(f"Error assigning lead: {str(e)}")
            return False
    
    @staticmethod
    def route_new_lead(
        lead_id: str,
        language: str,
        lead_name: str,
        lead_email: str = "",
        lead_phone: str = "",
        languages: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Route a new lead to an appropriate BD (preferred + transcripted languages)."""
        candidate_langs = _merge_lang_list(
            [language] if language else [],
            languages or [],
        )
        available_bd = LeadRoutingService.find_available_bd_for_languages(candidate_langs)
        
        if available_bd:
            success = LeadRoutingService.assign_lead_to_bd(str(lead_id), available_bd["bd_id"])
            
            if success:
                matched = [
                    lang for lang in candidate_langs
                    if _bd_speaks(available_bd, lang)
                ]
                match_note = f" (matched: {', '.join(matched)})" if matched else ""
                return {
                    "routed": True,
                    "bd_name": available_bd["name"],
                    "bd_id": available_bd["bd_id"],
                    "matched_languages": matched,
                    "reason": (
                        f"Automatically assigned to {available_bd['name']} "
                        f"(lowest workload){match_note}"
                    ),
                }
        
        pending_leads_collection.insert_one({
            "lead_id": str(lead_id),
            "lead_name": lead_name,
            "email": lead_email,
            "phone": lead_phone,
            "preferred_language": language,
            "transcriptedLanguages": [
                lang for lang in candidate_langs
                if _norm_lang(lang) != _norm_lang(language)
            ],
            "status": "pending",
            "created_at": datetime.utcnow()
        })
        
        leads_collection.update_one(
            {"_id": ObjectId(lead_id)},
            {"$set": {"status": "pending"}}
        )
        
        lang_label = ", ".join(candidate_langs) if candidate_langs else language
        return {
            "routed": False,
            "reason": f"No available BD speaks {lang_label} or all are at full capacity",
            "status": "pending"
        }

    @staticmethod
    def find_mismatched_leads(language: str) -> List[Dict[str, Any]]:
        """
        Find active leads that include `language` (preferred or transcripted)
        but are assigned to a BD who does NOT speak that language.
        """
        mismatched = []
        lang_key = _norm_lang(language)
        if not lang_key:
            return mismatched

        candidates = leads_collection.find({
            "status": {"$in": ["assigned", "in_progress"]},
            "assigned_bd": {"$ne": None}
        }).sort("assigned_at", 1)

        for lead in candidates:
            langs = _languages_for_lead(lead)
            if not any(_norm_lang(l) == lang_key for l in langs):
                continue
            bd = bds_collection.find_one({"bd_id": lead["assigned_bd"]}, {"_id": 0})
            if not bd:
                mismatched.append(lead)
                continue
            if not _bd_speaks(bd, language):
                mismatched.append(lead)

        return mismatched

    @staticmethod
    def reclaim_mismatched_leads(language: str, target_bd_id: str = None) -> List[Dict[str, Any]]:
        """
        When a language-matching BD has capacity, reclaim that language's leads
        from BDs who don't speak it.
        """
        reclaims = []
        mismatched = LeadRoutingService.find_mismatched_leads(language)

        for lead in mismatched:
            lead_id = str(lead["_id"])

            if target_bd_id:
                target = bds_collection.find_one({
                    "bd_id": target_bd_id,
                    "status": "active",
                })
                if not target or not _bd_speaks(target, language):
                    available_bd = LeadRoutingService.find_available_bd(language)
                else:
                    if LeadRoutingService._live_active_count(target_bd_id) >= MAX_ACTIVE_LEADS_PER_BD:
                        break  # target full — stop reclaiming to them
                    available_bd = target
            else:
                available_bd = LeadRoutingService.find_available_bd(language)

            if not available_bd:
                break

            if LeadRoutingService._live_active_count(available_bd["bd_id"]) >= MAX_ACTIVE_LEADS_PER_BD:
                continue

            # Don't reclaim onto the same mismatched BD
            if available_bd["bd_id"] == lead.get("assigned_bd"):
                continue

            previous_name = None
            prev = bds_collection.find_one({"bd_id": lead.get("assigned_bd")}, {"_id": 0, "name": 1})
            if prev:
                previous_name = prev.get("name")

            success = LeadRoutingService.assign_lead_to_bd(
                lead_id,
                available_bd["bd_id"],
                auto=True,
                reason=f"Reclaimed {language} lead from non-matching BD"
                + (f" ({previous_name})" if previous_name else ""),
            )

            if success:
                reclaims.append({
                    "lead_id": lead_id,
                    "lead_name": lead.get("name") or lead.get("lead_name", ""),
                    "previous_bd": previous_name or lead.get("assigned_bd"),
                    "assigned_to": available_bd["name"],
                    "language": language,
                    "type": "reclaim",
                })

        return reclaims
    
    @staticmethod
    def check_and_assign_pending_leads(language: str = None, bd_id: str = None) -> List[Dict[str, Any]]:
        """Check pending / unassigned leads and assign to available BDs when capacity opens."""
        assignments = []
        
        # 1) Pending queue — match preferred or transcriptedLanguages
        if language:
            lang_key = _norm_lang(language)
            pending_leads = []
            for p in pending_leads_collection.find({}).sort("created_at", 1):
                langs = _merge_lang_list(
                    [p.get("preferred_language")] if p.get("preferred_language") else [],
                    p.get("transcriptedLanguages") or [],
                )
                if any(_norm_lang(l) == lang_key for l in langs):
                    pending_leads.append(p)
        else:
            pending_leads = list(pending_leads_collection.find({}).sort("created_at", 1))

        # 2) Also unassigned leads in leads collection (new/pending, no BD)
        lead_query = {
            "$or": [{"assigned_bd": None}, {"assigned_bd": {"$exists": False}}],
            "status": {"$in": ["new", "pending"]},
        }

        seen_ids = {p.get("lead_id") for p in pending_leads}
        for lead in leads_collection.find(lead_query).sort("created_at", 1):
            lid = str(lead["_id"])
            if lid in seen_ids:
                continue
            langs = _languages_for_lead(lead)
            if language:
                lang_key = _norm_lang(language)
                if not any(_norm_lang(l) == lang_key for l in langs):
                    continue
            pending_leads.append({
                "lead_id": lid,
                "lead_name": lead.get("name") or lead.get("lead_name", ""),
                "preferred_language": lead.get("preferred_language"),
                "transcriptedLanguages": lead.get("transcriptedLanguages") or [],
                "_id": lead.get("_id"),
            })
            seen_ids.add(lid)
        
        for pending_lead in pending_leads:
            lead_id = pending_lead["lead_id"]
            # Prefer reading live lead doc for full language set
            lead_doc = None
            try:
                lead_doc = leads_collection.find_one({"_id": ObjectId(lead_id)})
            except Exception:
                lead_doc = None
            candidate_langs = (
                _languages_for_lead(lead_doc)
                if lead_doc
                else _merge_lang_list(
                    [pending_lead.get("preferred_language")] if pending_lead.get("preferred_language") else [],
                    pending_lead.get("transcriptedLanguages") or [],
                )
            )
            lead_language = pending_lead.get("preferred_language") or (candidate_langs[0] if candidate_langs else "")
            
            if bd_id:
                bd = bds_collection.find_one({
                    "bd_id": bd_id,
                    "status": "active",
                })
                if bd and _bd_speaks_any(bd, candidate_langs) and LeadRoutingService._live_active_count(bd_id) < MAX_ACTIVE_LEADS_PER_BD:
                    available_bd = bd
                else:
                    available_bd = LeadRoutingService.find_available_bd_for_languages(candidate_langs)
            else:
                available_bd = LeadRoutingService.find_available_bd_for_languages(candidate_langs)
            
            if available_bd:
                if LeadRoutingService._live_active_count(available_bd["bd_id"]) >= MAX_ACTIVE_LEADS_PER_BD:
                    continue
                
                success = LeadRoutingService.assign_lead_to_bd(lead_id, available_bd["bd_id"])
                
                if success:
                    pending_leads_collection.delete_many({"lead_id": lead_id})
                    matched = [lang for lang in candidate_langs if _bd_speaks(available_bd, lang)]
                    
                    assignments.append({
                        "lead_id": lead_id,
                        "lead_name": pending_lead.get("name") or pending_lead.get("lead_name", ""),
                        "assigned_to": available_bd["name"],
                        "language": lead_language,
                        "matched_languages": matched,
                        "type": "pending",
                    })
        
        return assignments

    @staticmethod
    def fill_capacity_for_bd(bd_id: str) -> List[Dict[str, Any]]:
        """
        After a BD frees a slot: for each language they speak,
        1) assign pending leads, then
        2) reclaim mismatched leads from BDs who don't speak that language.
        """
        results = []
        bd = bds_collection.find_one({"bd_id": bd_id}, {"_id": 0})
        if not bd or bd.get("status") != "active":
            return results

        languages = bd.get("supported_languages") or []
        for language in languages:
            if LeadRoutingService._live_active_count(bd_id) >= MAX_ACTIVE_LEADS_PER_BD:
                break

            pending = LeadRoutingService.check_and_assign_pending_leads(
                language=language,
                bd_id=bd_id,
            )
            results.extend(pending)

            if LeadRoutingService._live_active_count(bd_id) >= MAX_ACTIVE_LEADS_PER_BD:
                break

            reclaims = LeadRoutingService.reclaim_mismatched_leads(
                language=language,
                target_bd_id=bd_id,
            )
            results.extend(reclaims)

        return results
    
    @staticmethod
    def complete_lead(lead_id: str, *, auto_fill: bool = False) -> Dict[str, Any]:
        """Complete a lead. auto_fill=False disables pending/reclaim automation."""
        try:
            lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
            if not lead:
                return {"success": False, "error": "Lead not found"}
            
            bd_id = lead.get("assigned_bd")
            if not bd_id:
                return {"success": False, "error": "Lead not assigned to any BD"}
            
            now = datetime.utcnow()
            leads_collection.update_one(
                {"_id": ObjectId(lead_id)},
                {
                    "$set": {
                        "status": "completed",
                        "completed_at": now,
                        "reassign_requested": False,
                    }
                }
            )
            
            LeadRoutingService._sync_active_count(bd_id)

            assignments: List[Dict[str, Any]] = []
            if auto_fill:
                assignments = LeadRoutingService.fill_capacity_for_bd(bd_id)
            
            return {
                "success": True,
                "lead_id": lead_id,
                "bd_id": bd_id,
                "automatically_assigned": len(assignments) > 0,
                "assigned_leads": assignments,
                "reclaimed": [a for a in assignments if a.get("type") == "reclaim"],
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @staticmethod
    def get_bd_availability_status(active_lead_count: int) -> str:
        """Get BD availability status based on active lead count."""
        if active_lead_count >= MAX_ACTIVE_LEADS_PER_BD:
            return "Full"
        elif active_lead_count == 0:
            return "Available"
        else:
            return f"{MAX_ACTIVE_LEADS_PER_BD - active_lead_count} slots available"

# Global instance
lead_routing_service = LeadRoutingService()
