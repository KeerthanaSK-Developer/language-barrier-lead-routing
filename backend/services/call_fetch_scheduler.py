"""
One-shot APScheduler jobs: auto-fetch Classify recordings at end+5m and end+10m
when the user has not already pulled / processed data.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Sequence, Tuple

from bson import ObjectId

logger = logging.getLogger(__name__)

# Fallback attempts after scheduled end if manual Fetch was never completed.
SCHEDULED_FETCH_OFFSETS_MINUTES: Tuple[int, ...] = (5, 10)

_scheduler = None


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


def session_needs_scheduled_fetch(doc: Optional[dict]) -> bool:
    """True when recordings / insights are not already in hand or in flight."""
    if not doc or doc.get("status") == "cancelled":
        return False
    if doc.get("processing_status") in ("ready", "transcribing", "analyzing", "queued"):
        return False
    return True


def _job_id(session_id: str, offset_min: int) -> str:
    return f"call-fetch-{session_id}-end-plus-{offset_min}m"


def _run_scheduled_fetch(session_id: str, offset_min: int) -> None:
    from database import call_sessions_collection
    from routes.call_routes import fetch_session_attendance, _process_session_pipeline
    from services.classify_service import ClassifyError, classify_service

    try:
        oid = ObjectId(session_id)
    except Exception:
        logger.warning("Scheduled fetch skipped — invalid session_id %s", session_id)
        return

    doc = call_sessions_collection.find_one({"_id": oid})
    if not session_needs_scheduled_fetch(doc):
        logger.info(
            "Scheduled fetch +%sm skipped for %s (already have data or in progress)",
            offset_min,
            session_id,
        )
        return

    creator = classify_service.creator_email
    try:
        result = fetch_session_attendance(
            session_id,
            creator_email=creator,
            force_reprocess=False,
            source=f"scheduler_end_plus_{offset_min}m",
        )
    except ValueError as e:
        logger.info("Scheduled fetch +%sm for %s: %s", offset_min, session_id, e)
        return
    except ClassifyError as e:
        logger.warning(
            "Scheduled fetch +%sm Classify error for %s: %s",
            offset_min,
            session_id,
            e,
        )
        return
    except Exception:
        logger.exception("Scheduled fetch +%sm failed for %s", offset_min, session_id)
        return

    if result.get("should_process"):
        try:
            _process_session_pipeline(session_id)
        except Exception:
            logger.exception(
                "Scheduled Whisper pipeline failed for %s (+%sm)",
                session_id,
                offset_min,
            )
    else:
        logger.info(
            "Scheduled fetch +%sm for %s: %s (recordings=%s)",
            offset_min,
            session_id,
            result.get("message"),
            result.get("recordings_count"),
        )


def schedule_session_fetches(
    session_id: str,
    end_time: Any,
    *,
    offsets: Sequence[int] = SCHEDULED_FETCH_OFFSETS_MINUTES,
) -> None:
    """Register end+5m / end+10m one-shot jobs (replace if re-scheduled)."""
    if _scheduler is None:
        logger.warning("Scheduler not started — cannot schedule fetches for %s", session_id)
        return

    end = _as_utc(end_time)
    if not end:
        logger.warning("No end_time for session %s — skip scheduled fetches", session_id)
        return

    now = _utcnow()
    past_offsets = [o for o in offsets if end + timedelta(minutes=o) <= now]
    future_offsets = [o for o in offsets if end + timedelta(minutes=o) > now]

    for offset in future_offsets:
        run_at = end + timedelta(minutes=offset)
        try:
            _scheduler.add_job(
                _run_scheduled_fetch,
                trigger="date",
                run_date=run_at,
                id=_job_id(session_id, offset),
                args=[session_id, offset],
                replace_existing=True,
                misfire_grace_time=3600,
            )
            logger.info(
                "Scheduled fetch for session %s at end+%sm (%s)",
                session_id,
                offset,
                run_at.isoformat(),
            )
        except Exception:
            logger.exception("Could not schedule end+%sm fetch for %s", offset, session_id)

    # Catch-up after restart / late schedule: one immediate attempt at the latest past offset
    if past_offsets:
        offset = max(past_offsets)
        run_at = now + timedelta(seconds=5)
        try:
            _scheduler.add_job(
                _run_scheduled_fetch,
                trigger="date",
                run_date=run_at,
                id=_job_id(session_id, offset) + "-catchup",
                args=[session_id, offset],
                replace_existing=True,
                misfire_grace_time=3600,
            )
            logger.info(
                "Catch-up scheduled fetch for session %s (end+%sm due) in 5s",
                session_id,
                offset,
            )
        except Exception:
            logger.exception("Could not schedule catch-up fetch for %s", session_id)


def reschedule_pending_sessions() -> int:
    """On startup: re-arm jobs for meetings that still need recording data."""
    from database import call_sessions_collection

    count = 0
    query = {
        "status": {"$ne": "cancelled"},
        "processing_status": {"$nin": ["ready", "transcribing", "analyzing", "queued"]},
        "end_time": {"$exists": True},
    }
    for doc in call_sessions_collection.find(query).limit(500):
        session_id = str(doc["_id"])
        if not session_needs_scheduled_fetch(doc):
            continue
        schedule_session_fetches(session_id, doc.get("end_time"))
        count += 1
    return count


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    from apscheduler.schedulers.background import BackgroundScheduler

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.start()
    n = reschedule_pending_sessions()
    logger.info(
        "Call fetch scheduler started (end+%s min); re-armed %s pending session(s)",
        "/".join(str(o) for o in SCHEDULED_FETCH_OFFSETS_MINUTES),
        n,
    )


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    try:
        _scheduler.shutdown(wait=False)
    except Exception:
        logger.exception("Error shutting down call fetch scheduler")
    _scheduler = None
