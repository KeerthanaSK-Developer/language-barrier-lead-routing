"""Classify meeting schedule + post-call attendance / transcription / insights."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel

from auth import get_current_user
from config import FORCE_REPROCESS_RECORDINGS
from database import (
    bds_collection,
    call_sessions_collection,
    call_transcripts_collection,
    leads_collection,
    serialize_doc,
    users_collection,
)
from models import ScheduleCallRequest
from services.ai_service import ai_service, normalize_language_name
from services.classify_service import ClassifyError, classify_service
from services.email_service import email_service
from services.transcription_service import TranscriptionError, transcribe_recording_url
from services.call_fetch_scheduler import SCHEDULED_FETCH_OFFSETS_MINUTES

logger = logging.getLogger(__name__)
router = APIRouter()

# Manual Fetch button unlocks this many minutes after scheduled start.
FETCH_AVAILABLE_AFTER_START_MINUTES = 5

__all__ = ["router"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: Any) -> Optional[datetime]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    if isinstance(dt, str):
        try:
            parsed = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return None


def _fetch_available_at(start_time: Any) -> Optional[datetime]:
    start = _as_utc(start_time)
    if not start:
        return None
    return start + timedelta(minutes=FETCH_AVAILABLE_AFTER_START_MINUTES)


def _can_fetch_attendance(doc: dict) -> bool:
    """True once scheduled start + 5 minutes has passed (button unlock)."""
    available_at = _fetch_available_at(doc.get("start_time"))
    if not available_at:
        return False
    return _utcnow() >= available_at


def fetch_session_attendance(
    session_id: str,
    *,
    creator_email: Optional[str] = None,
    force_reprocess: bool = False,
    source: str = "manual",
) -> Dict[str, Any]:
    """
    Pull Classify attendance, merge recording URLs, queue Whisper when URLs exist.
    Manual button unlocks at start + 5 min; scheduler also calls this at end+5/10.
    """
    try:
        oid = ObjectId(session_id)
    except Exception as e:
        raise ValueError("Invalid session_id") from e

    doc = call_sessions_collection.find_one({"_id": oid})
    if not doc:
        raise ValueError("Call session not found")
    if doc.get("status") == "cancelled":
        raise ValueError("Session is cancelled")
    if not _can_fetch_attendance(doc):
        available_at = _fetch_available_at(doc.get("start_time"))
        detail = (
            f"Fetch available {FETCH_AVAILABLE_AFTER_START_MINUTES} minutes after meeting start"
            + (f" (from {available_at.isoformat()})" if available_at else "")
        )
        raise ValueError(detail)

    unique_id = doc.get("unique_id")
    if not unique_id:
        raise ValueError("Session has no Classify UniqueId")

    creator = creator_email or classify_service.creator_email
    result = classify_service.send_attendance_details(unique_id, creator_email=creator)

    now = _utcnow()
    prev_urls = set(_recording_urls(doc.get("recordings")))
    processed_urls = set(doc.get("processed_recording_urls") or [])
    merged = _merge_recordings(doc.get("recordings"), result.get("recordings") or [])
    merged_urls = _recording_urls(merged)
    merged_url_set = set(merged_urls)

    new_urls_appeared = bool(merged_url_set - prev_urls) or bool(merged_url_set - processed_urls)
    status_needs_work = doc.get("processing_status") in (
        None, "failed", "no_recordings", "queued", "waiting_end",
    )
    # Transcribe as soon as a recording URL exists (manual start+5m or scheduler).
    should_process = bool(merged_urls) and (
        new_urls_appeared
        or not processed_urls
        or processed_urls != merged_url_set
        or not doc.get("transcript")
        or status_needs_work
    )
    if force_reprocess and merged_urls:
        should_process = True
    if doc.get("processing_status") in ("transcribing", "analyzing") and not new_urls_appeared:
        should_process = False
    elif (
        doc.get("processing_status") in ("queued",)
        and not new_urls_appeared
        and not force_reprocess
    ):
        should_process = False

    update: Dict[str, Any] = {
        "attendance_fetched": True,
        "status": "ended",
        "session_details": result.get("session") or {},
        "attendance": result.get("attendance") or [],
        "recordings": merged,
        "minimum_attendance_time": result.get("minimum_attendance_time"),
        "classify_attendance_raw": result.get("raw") or {},
        "processing_error": None if should_process else doc.get("processing_error"),
        "updated_at": now,
        "attendance_fetched_at": now,
        "last_fetch_source": source,
    }
    if should_process:
        update["processing_status"] = "queued"
        update["processing_progress"] = {
            "phase": "queued",
            "current": 0,
            "total": len(merged_urls),
            "message": f"Queued {len(merged_urls)} recording(s) for transcription",
        }
    elif merged_urls:
        pass
    else:
        update["processing_status"] = "no_recordings"
        update["processing_progress"] = {
            "phase": "no_recordings",
            "message": "No recordings yet — scheduler retries at end+5m and end+10m",
        }

    call_sessions_collection.update_one({"_id": oid}, {"$set": update})

    # Keep lead table recording links in sync (all meetings for this lead)
    lead_id = doc.get("lead_id")
    if lead_id and merged_urls:
        try:
            sync_lead_recording_urls(str(lead_id))
        except Exception as e:
            logger.warning("Could not sync lead recording URLs: %s", e)

    refreshed = call_sessions_collection.find_one({"_id": oid})
    out = _serialize_session(refreshed)
    out.pop("classify_create_raw", None)
    out.pop("classify_attendance_raw", None)

    added = len(merged_url_set - prev_urls)
    if should_process:
        message = (
            f"Attendance refreshed; processing {len(merged_urls)} recording(s)"
            + (f" ({added} new)" if added else "")
        )
    else:
        message = "Attendance details refreshed"
    return {
        "message": message,
        "session": out,
        "should_process": should_process,
        "session_id": session_id,
        "recordings_count": len(merged_urls),
        "new_recordings_count": added,
        "minimum_attendance_time": result.get("minimum_attendance_time"),
    }


def _recording_urls(recordings: Any) -> List[str]:
    urls: List[str] = []
    seen: Set[str] = set()
    for r in recordings or []:
        url = ""
        if isinstance(r, dict):
            url = str(r.get("url") or "").strip()
        elif isinstance(r, str):
            url = r.strip()
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def sync_lead_recording_urls(lead_id: Optional[str]) -> List[str]:
    """
    Aggregate every recording URL across all meetings for a lead onto the lead doc
    so admin/BD tables can show links without opening each session.
    """
    if not lead_id:
        return []
    try:
        lead_oid = ObjectId(lead_id)
    except Exception:
        return []
    urls: List[str] = []
    seen: Set[str] = set()
    for sess in call_sessions_collection.find({"lead_id": lead_id}):
        for url in _recording_urls(sess.get("recordings")):
            if url not in seen:
                seen.add(url)
                urls.append(url)
    leads_collection.update_one(
        {"_id": lead_oid},
        {"$set": {
            "call_recording_urls": urls,
            "call_recording_count": len(urls),
            "updated_at": _utcnow(),
        }},
    )
    return urls


def _merge_recordings(existing: Any, incoming: Any) -> List[Dict[str, Any]]:
    """Union recordings by URL — Classify often returns split clips over time."""
    by_url: Dict[str, Dict[str, Any]] = {}
    for r in list(existing or []) + list(incoming or []):
        if isinstance(r, str) and r.startswith("http"):
            by_url[r] = {"type": "recording", "url": r}
            continue
        if not isinstance(r, dict):
            continue
        url = str(r.get("url") or "").strip()
        if not url.startswith("http"):
            continue
        by_url[url] = {**r, "url": url}
    return list(by_url.values())


def _serialize_session(doc: dict) -> dict:
    out = serialize_doc(doc)
    if not out:
        return {}
    available_at = _fetch_available_at(doc.get("start_time"))
    out["fetch_available_at"] = available_at.isoformat() if available_at else None
    out["can_fetch_recordings"] = _can_fetch_attendance(doc) and doc.get("status") != "cancelled"
    out["fetch_after_start_minutes"] = FETCH_AVAILABLE_AFTER_START_MINUTES
    out["scheduled_fetch_after_end_minutes"] = list(SCHEDULED_FETCH_OFFSETS_MINUTES)
    return out


def _can_access_lead(user: dict, lead: dict) -> bool:
    if user.get("role") == "admin":
        return True
    if user.get("role") == "bd" and lead.get("assigned_bd") == user.get("id"):
        return True
    return False


def _can_access_session(user: dict, doc: dict) -> bool:
    """Admin, session owner, or currently assigned BD for the lead may access."""
    if user.get("role") == "admin":
        return True
    if user.get("role") != "bd":
        return False
    uid = user.get("id")
    if doc.get("bd_id") == uid or doc.get("scheduled_by") == uid:
        return True
    lead_id = doc.get("lead_id")
    if not lead_id:
        return False
    try:
        lead = leads_collection.find_one({"_id": ObjectId(lead_id)})
    except Exception:
        return False
    return bool(lead and lead.get("assigned_bd") == uid)


def _session_recency_key(doc: dict) -> tuple:
    """Sort key so the most recent call wins for lead-table fields."""
    return (str(doc.get("start_time") or ""), str(doc.get("updated_at") or ""))


def _is_latest_ready_session(lead_id: str, session_id: str, session_doc: dict) -> bool:
    """True when this session is the newest ready call for the lead."""
    best_id = session_id
    best_key = _session_recency_key(session_doc)
    for other in call_sessions_collection.find(
        {
            "lead_id": lead_id,
            "processing_status": "ready",
            "insights": {"$ne": None},
        }
    ):
        oid = str(other.get("_id"))
        if oid == session_id:
            continue
        key = _session_recency_key(other)
        if key > best_key:
            best_key = key
            best_id = oid
    return best_id == session_id


def _get_lead_or_404(lead_id: str) -> dict:
    try:
        oid = ObjectId(lead_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lead_id")
    lead = leads_collection.find_one({"_id": oid})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


def _host_for_user(user: dict) -> Dict[str, str]:
    return {"name": user.get("name") or "Host", "email": (user.get("email") or "").lower().strip()}


def _process_session_pipeline(session_id: str) -> None:
    """
    Background: ffmpeg + local Whisper for EVERY recording URL, then Claude insights.
    Writes live progress to the session so the UI can poll.
    """
    oid = ObjectId(session_id)
    try:
        doc = call_sessions_collection.find_one({"_id": oid})
        if not doc:
            return
        recordings = doc.get("recordings") or []
        urls = _recording_urls(recordings)
        if not urls:
            call_sessions_collection.update_one(
                {"_id": oid},
                {"$set": {
                    "processing_status": "failed",
                    "processing_error": "No recording URLs in attendance payload",
                    "processing_progress": None,
                    "updated_at": _utcnow(),
                }},
            )
            return

        total = len(urls)
        texts: List[str] = []
        all_chunks: List[Dict[str, Any]] = []
        per_recording: List[Dict[str, Any]] = []
        whisper_langs: List[str] = []

        # Preferred language → Whisper hint (critical for Tamil/Hindi/etc.)
        lead_id_early = doc.get("lead_id")
        language_hint = ""
        if lead_id_early:
            try:
                lead_early = leads_collection.find_one({"_id": ObjectId(lead_id_early)}) or {}
                language_hint = str(lead_early.get("preferred_language") or "").strip()
            except Exception:
                language_hint = ""

        call_sessions_collection.update_one(
            {"_id": oid},
            {"$set": {
                "processing_status": "transcribing",
                "processing_error": None,
                "processing_progress": {
                    "phase": "transcribing",
                    "current": 0,
                    "total": total,
                    "message": f"Starting transcription of {total} recording(s)",
                    "language_hint": language_hint or None,
                },
                "updated_at": _utcnow(),
            }},
        )

        for i, url in enumerate(urls):
            call_sessions_collection.update_one(
                {"_id": oid},
                {"$set": {
                    "processing_status": "transcribing",
                    "processing_progress": {
                        "phase": "transcribing",
                        "current": i + 1,
                        "total": total,
                        "message": f"Transcribing recording {i + 1} of {total}",
                        "current_url": url,
                        "language_hint": language_hint or None,
                    },
                    "updated_at": _utcnow(),
                }},
            )
            logger.info(
                "Session %s: transcribing recording %s/%s hint=%s",
                session_id, i + 1, total, language_hint or "(auto)",
            )
            result = transcribe_recording_url(url, language_hint=language_hint or None)
            text = result.get("transcript") or ""
            texts.append(text)
            for lang in result.get("languages") or []:
                name = normalize_language_name(str(lang))
                if name and name not in whisper_langs:
                    whisper_langs.append(name)
            per_recording.append({
                "index": i,
                "url": url,
                "transcript": text,
                "chunk_count": result.get("chunk_count"),
                "languages": result.get("languages") or [],
            })
            for ch in result.get("chunks") or []:
                all_chunks.append({**ch, "recording_index": i, "source_url": url})

            partial = "\n\n---\n\n".join(t for t in texts if t).strip()
            call_sessions_collection.update_one(
                {"_id": oid},
                {"$set": {
                    "transcript": partial or None,
                    "transcript_partial": True,
                    "recording_transcripts": per_recording,
                    "processing_progress": {
                        "phase": "transcribing",
                        "current": i + 1,
                        "total": total,
                        "message": f"Finished recording {i + 1} of {total}",
                        "current_url": url,
                    },
                    "updated_at": _utcnow(),
                }},
            )

        transcript = "\n\n---\n\n".join(t for t in texts if t).strip()
        if not transcript:
            raise TranscriptionError("Whisper returned empty transcript for all recordings")

        call_transcripts_collection.update_one(
            {"session_id": session_id},
            {"$set": {
                "session_id": session_id,
                "unique_id": doc.get("unique_id"),
                "lead_id": doc.get("lead_id"),
                "transcript": transcript,
                "chunks": all_chunks,
                "recording_count": len(texts),
                "recording_transcripts": per_recording,
                "updated_at": _utcnow(),
                "created_at": doc.get("created_at") or _utcnow(),
            }},
            upsert=True,
        )

        call_sessions_collection.update_one(
            {"_id": oid},
            {"$set": {
                "processing_status": "analyzing",
                "transcript": transcript,
                "transcript_partial": False,
                "processing_progress": {
                    "phase": "analyzing",
                    "current": total,
                    "total": total,
                    "message": "Generating call insights",
                },
                "updated_at": _utcnow(),
            }},
        )

        insights: Dict[str, Any] = {}
        lead_id = doc.get("lead_id")
        lead_doc_peek = {}
        if lead_id:
            try:
                lead_doc_peek = leads_collection.find_one({"_id": ObjectId(lead_id)}) or {}
            except Exception:
                lead_doc_peek = {}

        try:
            insights = ai_service.analyze_call_insights(
                transcript,
                lead_name=doc.get("lead_name") or "",
                lead_email=doc.get("lead_email") or "",
                preferred_language=str(lead_doc_peek.get("preferred_language") or ""),
                attendance=doc.get("attendance") or [],
                session=doc.get("session_details") or {},
            )
        except Exception as e:
            logger.error("Call insights failed for %s: %s", session_id, e)
            insights = {
                "interested": None,
                "interest_level": "unknown",
                "summary": "Transcript stored; AI insights failed.",
                "error": str(e),
            }

        # Call languages:
        # - Fluent in BDA language → that language is call language
        # - Language barrier (not fluent) → use lead preferred for next BD matching
        preferred = normalize_language_name(str(lead_doc_peek.get("preferred_language") or ""))
        ai_fluent = [
            normalize_language_name(str(x))
            for x in (insights.get("languages_detected") or [])
            if str(x).strip()
        ]
        ai_fluent = [l for l in ai_fluent if l]
        ai_struggled = [
            normalize_language_name(str(x))
            for x in (insights.get("languages_struggled") or [])
            if str(x).strip()
        ]
        ai_struggled = [l for l in ai_struggled if l]
        struggled_set = {l.lower() for l in ai_struggled}

        if ai_fluent:
            call_languages = [l for l in ai_fluent if l.lower() not in struggled_set]
        else:
            call_languages = [
                l for l in (whisper_langs or [])
                if l and l.lower() not in struggled_set
            ]
        call_languages = [l for l in call_languages if l.lower() not in struggled_set]

        # Fluent call language ≠ preferred is OK — clear false "mismatch only" barriers
        if insights.get("language_barrier"):
            reason_l = str(insights.get("language_barrier_reason") or "").lower()
            struggle_hints = (
                "struggl", "couldn't understand", "could not understand",
                "can't understand", "cannot understand", "not understand",
                "not fluent", "wasn't fluent", "was not fluent", "non-fluent",
                "asked to switch", "please speak", "not comfortable in",
                "difficult to follow", "confused by language", "couldn't continue",
                "unable to communicate", "poor understanding", "language problem",
                "could not continue", "needs a different", "need a different",
                "cannot speak", "can't speak", "could not speak", "speak up",
            )
            mismatch_only_hints = (
                "preferred language",
                "differ",
                "does not match",
                "doesn't match",
                "was conducted in",
                "conducted in",
                "was spoken during",
                "instead of preferred",
                "no " + (preferred.lower() + " was spoken" if preferred else "\0"),
            )
            has_struggle = bool(ai_struggled) or any(h in reason_l for h in struggle_hints)
            looks_like_mismatch_only = (
                (not has_struggle)
                and bool(call_languages)
                and (
                    not reason_l.strip()
                    or any(h in reason_l for h in mismatch_only_hints if h)
                )
            )
            if looks_like_mismatch_only:
                insights["language_barrier"] = False
                insights["language_barrier_reason"] = ""

        # Garbled / failed transcription is NOT a language barrier — do not reassign for that
        barrier_reason_l = str(insights.get("language_barrier_reason") or "").lower()
        summary_l = str(insights.get("summary") or "").lower()
        garbled_hints = (
            "garbled", "incoherent", "unintelligible", "cannot assess",
            "could not assess", "couldn't assess", "transcript quality",
            "transcription failed", "cannot understand the transcript",
            "communication could not be established clearly",
            "stable connection for proper assessment",
        )
        looks_garbled = any(h in barrier_reason_l or h in summary_l for h in garbled_hints)
        if looks_garbled and insights.get("language_barrier"):
            logger.info(
                "Clearing language_barrier for session %s — reason looks like bad transcript, not fluency",
                session_id,
            )
            insights["language_barrier"] = False
            insights["language_barrier_reason"] = ""
            risk = list(insights.get("risk_flags") or [])
            note = "Transcript quality low — reprocess with correct language; do not treat as language barrier"
            if note not in risk:
                risk.append(note)
            insights["risk_flags"] = risk

        # Barrier → call language = preferred (for reassign matching) + reason names it
        if insights.get("language_barrier"):
            if preferred:
                call_languages = [preferred]
                reason = str(insights.get("language_barrier_reason") or "").strip()
                pref_note = f"Lead prefers {preferred}"
                if preferred.lower() not in reason.lower():
                    reason = f"{reason} — {pref_note}".strip(" —") if reason else (
                        f"Learner not fluent in call language; {pref_note} — reassign"
                    )
                insights["language_barrier_reason"] = reason
            elif not call_languages and ai_struggled:
                # No preferred on file — keep empty fluent list; struggled stays out
                call_languages = []

        insights["languages_spoken_raw"] = list(whisper_langs or [])
        insights["languages_struggled"] = ai_struggled
        insights["languages_detected"] = call_languages
        # Re-apply join caps after barrier clear/set
        join = insights.get("join_probability")
        if isinstance(join, int):
            if insights.get("lead_not_interested") or insights.get("interested") is False:
                join = min(join, 20)
            if insights.get("language_barrier"):
                join = min(join, 30)
            if str(insights.get("sales_cooperation") or "").lower() == "poor":
                join = min(join, 35)
            insights["join_probability"] = max(0, join)

        call_sessions_collection.update_one(
            {"_id": oid},
            {"$set": {
                "processing_status": "ready",
                "insights": insights,
                "interested": insights.get("interested"),
                "interest_level": insights.get("interest_level"),
                "join_probability": insights.get("join_probability"),
                "processed_recording_urls": urls,
                "processing_progress": {
                    "phase": "ready",
                    "current": total,
                    "total": total,
                    "message": f"Processed {total} recording(s)",
                },
                "processing_error": None,
                "updated_at": _utcnow(),
            }},
        )

        if lead_id:
            try:
                lead_oid = ObjectId(lead_id)
                lead_doc = lead_doc_peek or leads_collection.find_one({"_id": lead_oid}) or {}
                # Lead table always mirrors the newest call; older reprocess must not overwrite.
                apply_to_lead = _is_latest_ready_session(lead_id, session_id, {
                    "start_time": doc.get("start_time"),
                    "updated_at": _utcnow(),
                })
                lead_set: Dict[str, Any] = {"updated_at": _utcnow()}
                if apply_to_lead:
                    snapshot = {
                        "session_id": session_id,
                        "interested": insights.get("interested"),
                        "interest_level": insights.get("interest_level"),
                        "interest_score": insights.get("interest_score"),
                        "join_probability": insights.get("join_probability"),
                        "summary": insights.get("summary"),
                        "sentiment": insights.get("sentiment"),
                        "languages_detected": call_languages,
                        "language_barrier": bool(insights.get("language_barrier")),
                        "language_barrier_reason": insights.get("language_barrier_reason") or "",
                        "sales_cooperation": insights.get("sales_cooperation") or "unknown",
                        "cooperation_reason": insights.get("cooperation_reason") or "",
                        "lead_not_interested": bool(
                            insights.get("lead_not_interested")
                            or insights.get("interested") is False
                        ),
                        "not_interested_reason": insights.get("not_interested_reason") or "",
                        "preferred_courses_or_topics": insights.get("preferred_courses_or_topics") or [],
                        "timeline": insights.get("timeline") or "",
                        "best_callback_time": insights.get("best_callback_time") or "",
                        "objections": insights.get("objections") or [],
                        "buying_signals": insights.get("buying_signals") or [],
                        "next_actions_for_bda": insights.get("next_actions_for_bda") or [],
                        "risk_flags": insights.get("risk_flags") or [],
                        "updated_at": _utcnow().isoformat(),
                    }
                    lead_set.update({
                        "last_call_session_id": session_id,
                        "last_call_insights": snapshot,
                        "callLanguages": call_languages,
                        "transcriptedLanguages": call_languages,
                        "call_join_probability": insights.get("join_probability"),
                        "call_interest_level": insights.get("interest_level"),
                        "call_interested": insights.get("interested"),
                    })

                # Always refresh recording links on the lead (every meeting’s videos)
                try:
                    rec_urls = sync_lead_recording_urls(lead_id)
                    if apply_to_lead:
                        lead_set["call_recording_urls"] = rec_urls
                        lead_set["call_recording_count"] = len(rec_urls)
                except Exception as e:
                    logger.warning("Recording URL sync failed: %s", e)

                # Enable admin Reassign when: language barrier, poor BDA engagement, or not interested
                ai_reasons = []
                source = None
                if insights.get("language_barrier"):
                    source = "ai_language_barrier"
                    barrier_reason = (
                        insights.get("language_barrier_reason")
                        or "Language barrier detected on call"
                    )
                    if preferred and preferred.lower() not in barrier_reason.lower():
                        barrier_reason = f"{barrier_reason} (lead prefers {preferred})"
                    ai_reasons.append(barrier_reason)
                if str(insights.get("sales_cooperation") or "").lower() == "poor":
                    source = source or "ai_cooperation"
                    ai_reasons.append(
                        insights.get("cooperation_reason")
                        or "BDA did not engage well with the lead"
                    )
                if insights.get("lead_not_interested") or insights.get("interested") is False:
                    source = source or "ai_not_interested"
                    ai_reasons.append(
                        insights.get("not_interested_reason")
                        or "Lead not interested (BDA communication may still be fine)"
                    )
                if ai_reasons:
                    existing_reason = (lead_doc.get("reassign_reason") or "").strip()
                    if lead_doc.get("reassign_source") == "bd" and existing_reason:
                        combined = f"{existing_reason} | AI: {' · '.join(ai_reasons)}"
                        lead_set["reassign_requested"] = True
                        lead_set["reassign_reason"] = combined
                    else:
                        lead_set["reassign_requested"] = True
                        lead_set["reassign_reason"] = " · ".join(ai_reasons)
                        lead_set["reassign_source"] = source
                        lead_set["reassign_requested_at"] = _utcnow()
                        lead_set["reassign_requested_by"] = "ai"
                elif (
                    apply_to_lead
                    and str(lead_doc.get("reassign_source") or "").startswith("ai_")
                    and not insights.get("language_barrier")
                    and str(insights.get("sales_cooperation") or "").lower() != "poor"
                    and not (
                        insights.get("lead_not_interested")
                        or insights.get("interested") is False
                    )
                ):
                    # Clear stale AI reassign when latest call no longer warrants it
                    lead_set["reassign_requested"] = False
                    lead_set["reassign_reason"] = None
                    lead_set["reassign_source"] = None
                    lead_set["reassign_requested_at"] = None
                    lead_set["reassign_requested_by"] = None

                leads_collection.update_one({"_id": lead_oid}, {"$set": lead_set})
            except Exception as e:
                logger.warning("Could not attach insights to lead: %s", e)

    except TranscriptionError as e:
        logger.error("Transcription failed for session %s: %s", session_id, e)
        call_sessions_collection.update_one(
            {"_id": oid},
            {"$set": {
                "processing_status": "failed",
                "processing_error": str(e),
                "processing_progress": {
                    "phase": "failed",
                    "message": str(e),
                },
                "updated_at": _utcnow(),
            }},
        )
    except Exception as e:
        logger.exception("Pipeline failed for session %s", session_id)
        call_sessions_collection.update_one(
            {"_id": oid},
            {"$set": {
                "processing_status": "failed",
                "processing_error": str(e),
                "processing_progress": {
                    "phase": "failed",
                    "message": str(e),
                },
                "updated_at": _utcnow(),
            }},
        )


@router.get("/config-status")
async def classify_config_status(current_user: dict = Depends(get_current_user)):
    return {
        "classify_configured": classify_service.is_configured,
        "ai_configured": ai_service.is_configured,
        "creator_email_set": bool(classify_service.creator_email),
    }


@router.post("/schedule")
async def schedule_call(
    body: ScheduleCallRequest,
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] not in ("admin", "bd"):
        raise HTTPException(status_code=403, detail="Only admin or BD can schedule calls")

    if not classify_service.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Classify is not configured on the server",
        )

    lead = _get_lead_or_404(body.lead_id)
    if not _can_access_lead(current_user, lead):
        raise HTTPException(status_code=403, detail="Not allowed to schedule for this lead")

    lead_id = str(lead["_id"])
    lead_name = lead.get("name") or "Lead"
    lead_email = (lead.get("email") or "").lower().strip()
    if not lead_email:
        raise HTTPException(status_code=400, detail="Lead has no email")

    # Classify host is always the org admin account (not the assigned BD)
    host = {"name": "keerthanaSK", "email": "keerthana@hclguvi.com"}
    assigned_bd = lead.get("assigned_bd")

    label = (body.label or f"BD call — {lead_name}").strip()[:120]

    try:
        created = classify_service.create_meeting(
            label=label,
            start_time=body.start_time,
            end_time=body.end_time,
            hosts=[host],
            batch_data=[],  # lead joins as guest
            auto_recording_start=body.auto_recording_start or "on",
        )
    except ClassifyError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    now = _utcnow()
    session_doc = {
        "lead_id": lead_id,
        "lead_name": lead_name,
        "lead_email": lead_email,
        "bd_id": assigned_bd or current_user.get("id"),
        "bd_email": host["email"],
        "bd_name": host["name"],
        "scheduled_by": current_user["id"],
        "scheduled_by_email": current_user.get("email"),
        "label": label,
        "start_time": body.start_time,
        "end_time": body.end_time,
        "unique_id": created["unique_id"],
        "join_url": created.get("join_url") or "",
        "classify_details": created.get("details") or {},
        "classify_create_raw": created.get("raw") or {},
        "status": "scheduled",
        "attendance_fetched": False,
        "recordings": [],
        "attendance": [],
        "session_details": None,
        "minimum_attendance_time": None,
        "transcript": None,
        "transcript_partial": False,
        "recording_transcripts": [],
        "processed_recording_urls": [],
        "insights": None,
        "processing_status": None,
        "processing_error": None,
        "processing_progress": None,
        "created_at": now,
        "updated_at": now,
    }
    result = call_sessions_collection.insert_one(session_doc)
    session_id = str(result.inserted_id)
    session_doc["id"] = session_id
    session_doc.pop("_id", None)
    # Drop bulky raw from response
    session_doc.pop("classify_create_raw", None)

    try:
        from services.call_fetch_scheduler import schedule_session_fetches
        schedule_session_fetches(session_id, body.end_time)
    except Exception:
        logger.exception("Could not schedule end+5/10 fetches for session %s", session_id)

    email_queued = email_service.send_meeting_scheduled(
        to_name=lead_name,
        to_email=lead_email,
        label=label,
        start_time=body.start_time,
        end_time=body.end_time,
        join_url=created.get("join_url") or "",
        host_name=host["name"],
    )

    return {
        "message": "Meeting scheduled",
        "session": session_doc,
        "unique_id": created["unique_id"],
        "email_queued": email_queued,
    }


@router.get("/")
async def list_call_sessions(
    lead_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    When lead_id is set: return ALL calls for that lead (admin or assigned BD),
    so every recording is visible across reassignments / multiple meetings.
    Without lead_id: BD sees own sessions; admin sees all.
    """
    query: Dict[str, Any] = {}
    if lead_id:
        lead = _get_lead_or_404(lead_id)
        if not _can_access_lead(current_user, lead):
            raise HTTPException(status_code=403, detail="Not allowed")
        query["lead_id"] = lead_id
    elif current_user["role"] == "bd":
        query["bd_id"] = current_user["id"]
    elif current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    items: List[dict] = []
    for doc in call_sessions_collection.find(query).sort("start_time", -1).limit(100):
        s = _serialize_session(doc)
        # Strip large fields from list — UI shows insights only, not raw transcript
        s.pop("classify_create_raw", None)
        s.pop("classify_attendance_raw", None)
        s.pop("transcript", None)
        s.pop("transcript_preview", None)
        s.pop("recording_transcripts", None)
        items.append(s)
    return {"items": items, "total": len(items)}


@router.get("/{session_id}")
async def get_call_session(session_id: str, current_user: dict = Depends(get_current_user)):
    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    doc = call_sessions_collection.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Call session not found")
    if not _can_access_session(current_user, doc):
        raise HTTPException(status_code=403, detail="Not allowed")
    out = _serialize_session(doc)
    out.pop("classify_create_raw", None)
    return out


@router.post("/{session_id}/fetch-attendance")
async def fetch_attendance(
    session_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """
    Manual fetch: unlocked at start + 5 min. Transcribes immediately when recording URLs exist.
    If the user never fetches, APScheduler retries at end+5m and end+10m.
    """
    if current_user["role"] not in ("admin", "bd"):
        raise HTTPException(status_code=403, detail="Only admin or BD can fetch attendance")

    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    doc = call_sessions_collection.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Call session not found")
    if not _can_access_session(current_user, doc):
        raise HTTPException(status_code=403, detail="Not allowed")

    creator = classify_service.creator_email or current_user.get("email")
    try:
        result = fetch_session_attendance(
            session_id,
            creator_email=creator,
            force_reprocess=bool(FORCE_REPROCESS_RECORDINGS),
            source="manual",
        )
    except ValueError as e:
        msg = str(e)
        code = 409 if "Fetch available" in msg or "cancelled" in msg.lower() else 400
        if "not found" in msg.lower():
            code = 404
        raise HTTPException(status_code=code, detail=msg) from e
    except ClassifyError as e:
        code = 409 if e.retryable else 502
        raise HTTPException(
            status_code=code,
            detail=str(e) or "Try again after some time",
        ) from e

    if result.get("should_process"):
        background_tasks.add_task(_process_session_pipeline, session_id)

    return {
        "message": result["message"],
        "session": result["session"],
        "recordings_count": result["recordings_count"],
        "new_recordings_count": result["new_recordings_count"],
        "minimum_attendance_time": result.get("minimum_attendance_time"),
    }


@router.post("/{session_id}/reprocess")
async def reprocess_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] not in ("admin", "bd"):
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    doc = call_sessions_collection.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_access_session(current_user, doc):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not doc.get("recordings"):
        raise HTTPException(status_code=400, detail="No recordings stored yet — fetch attendance first")
    call_sessions_collection.update_one(
        {"_id": oid},
        {"$set": {"processing_status": "queued", "processing_error": None, "updated_at": _utcnow()}},
    )
    background_tasks.add_task(_process_session_pipeline, session_id)
    return {"message": "Reprocessing started"}
