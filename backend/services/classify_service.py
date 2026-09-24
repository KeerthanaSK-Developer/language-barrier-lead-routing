"""Classify HTTP client — create meetings + fetch attendance/recordings."""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from config import (
    CLASSIFY_API_KEY,
    CLASSIFY_AUTH_TOKEN,
    CLASSIFY_CREATOR_EMAIL,
    CLASSIFY_ORG_ID,
    CLASSIFY_PRODUCT,
    CLASSIFY_TIMEOUT_SECONDS,
    CLASSIFY_TIMEZONE,
    CLASSIFY_URL,
)

logger = logging.getLogger(__name__)


class ClassifyError(Exception):
    def __init__(self, message: str, *, status: str = "", retryable: bool = False, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.retryable = retryable
        self.payload = payload


def _pick(obj: Any, *keys: str, default=None):
    if not isinstance(obj, dict):
        return default
    for key in keys:
        if key in obj and obj[key] is not None:
            return obj[key]
    return default


def _to_unix_seconds(value: Union[str, int, float]) -> int:
    """Classify expects start_time / givenEndTime as int32 unix seconds."""
    if isinstance(value, (int, float)):
        ts = int(value)
        # milliseconds accidentally passed
        if ts > 10_000_000_000:
            ts //= 1000
        return ts
    text = str(value).strip()
    if not text:
        raise ClassifyError("Empty datetime for Classify start/end time")
    if text.isdigit():
        return _to_unix_seconds(int(text))
    # ISO-8601 from frontend (…Z or +00:00)
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as e:
        raise ClassifyError(f"Invalid datetime for Classify: {text}") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


class ClassifyService:
    def __init__(self):
        self.base_url = CLASSIFY_URL
        self.api_key = CLASSIFY_API_KEY
        self.auth_token = CLASSIFY_AUTH_TOKEN
        self.org_id = CLASSIFY_ORG_ID
        self.product = CLASSIFY_PRODUCT
        self.creator_email = CLASSIFY_CREATOR_EMAIL
        self.timezone = CLASSIFY_TIMEZONE
        self.timeout = CLASSIFY_TIMEOUT_SECONDS

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.auth_token and self.org_id)

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        if not self.is_configured:
            raise ClassifyError(
                "Classify is not configured. Set CLASSIFY_URL, CLASSIFY_API_KEY, "
                "CLASSIFY_AUTH_TOKEN, CLASSIFY_ORG_ID."
            )
        url = f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "authorization-key": self.api_key,
                "User-Agent": "bd-lead-routing/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")
            logger.error("Classify HTTP %s %s: %s", e.code, path, err[:500])
            raise ClassifyError(f"Classify HTTP {e.code}: {err[:300]}", status=str(e.code)) from e
        except Exception as e:
            logger.error("Classify request failed %s: %s", path, e)
            raise ClassifyError(f"Classify request failed: {e}") from e

        try:
            return json.loads(raw) if raw else {}
        except json.JSONDecodeError as e:
            raise ClassifyError(f"Classify returned invalid JSON: {raw[:200]}") from e

    def create_meeting(
        self,
        *,
        label: str,
        start_time: str,
        end_time: str,
        hosts: List[Dict[str, str]],
        batch_data: Optional[List[Dict[str, str]]] = None,
        auto_recording_start: str = "on",
        min_duration: int = 1,
        meeting_type: str = "open",
        created_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        POST /createMS (also tries /createMs).
        Returns unique_id + full Details/data payload for storage.
        """
        start_ts = _to_unix_seconds(start_time)
        end_ts = _to_unix_seconds(end_time)
        if end_ts <= start_ts:
            raise ClassifyError("givenEndTime must be after start_time")

        creator = (created_by or self.creator_email or "").strip()
        if not creator:
            raise ClassifyError(
                "CLASSIFY_CREATOR_EMAIL is not set (required as created_by for createMS)"
            )

        hosts_norm = [
            {
                "name": (h.get("name") or h.get("Name") or "").strip(),
                "email": (h.get("email") or h.get("Email") or "").lower().strip(),
            }
            for h in hosts
        ]
        batch_norm = [
            {
                "name": (s.get("name") or s.get("Name") or "").strip(),
                "email": (s.get("email") or s.get("Email") or "").lower().strip(),
            }
            for s in (batch_data or [])
            if (s.get("name") or s.get("Name")) and (s.get("email") or s.get("Email"))
        ]
        if not hosts_norm or not all(h["name"] and h["email"] for h in hosts_norm):
            raise ClassifyError("hosts require BDA name and email")

        # Exact MeetData shape expected by Classify /createMS
        body = {
            "label": label,
            "Start_time": start_ts,
            "End_time": end_ts,
            "thumbnail": "Default",
            "minDuration": int(min_duration),
            "Batch_data": batch_norm,
            "studentNotes": "",
            "Enable_chat": "on",
            "authToken": self.auth_token,
            "subject": "Default",
            "message": "Default",
            "footer": "Default",
            "hosts": hosts_norm,
            "Product": self.product,
            "Created_by": creator,
            "recording_autoStart": auto_recording_start,
            "isEndTimeGiven": "on",
            "studentHMSRole": "allow-audio-video-ss",
            "timezone": self.timezone,
            "Org_id": self.org_id,
            "meetingType": (meeting_type or "open").lower(),
            "repeatSchedule": {"type": "noRepeat"},
            "guestConfig": {
                "isGuestParticipantAllowed": True,
                "guestInformationCollectionFields": [],
            },
            "isPollEnabled": False,
            "selectedPollTemplateIds": [],
            "isQuizEnabled": False,
            "selectedQuizTemplateIds": [],
            "breakoutroom_enabled": False,
            "max_breakoutroom": 0,
            "enableEarlyStart": False,
            "earlyStartMinutes": 0,
        }

        last_err: Optional[Exception] = None
        resp: Dict[str, Any] = {}
        for path in ("/createMS", "/createMs"):
            try:
                resp = self._post(path, body)
                break
            except ClassifyError as e:
                last_err = e
                if "404" in str(e) or "405" in str(e):
                    continue
                raise
        else:
            raise ClassifyError(str(last_err or "createMS failed"))

        access = _pick(resp, "Access", "access", default=True)
        status = str(_pick(resp, "Status", "status", default="") or "")
        message = str(_pick(resp, "Message", "message", default="") or "")
        details = _pick(resp, "Details", "details", "data", default={}) or {}
        if not isinstance(details, dict):
            details = {}

        if access is False or (status and not str(status).startswith("200")):
            raise ClassifyError(
                message or "Classify createMS failed",
                status=status,
                payload=resp,
            )

        unique_id = _pick(
            details,
            "UniqueId", "uniqueId", "unique_id",
            default=_pick(resp, "UniqueId", "uniqueId", "unique_id"),
        )
        if not unique_id:
            raise ClassifyError(
                "Classify createMS succeeded but UniqueId missing in response",
                payload=resp,
            )

        return {
            "raw": resp,
            "details": details,
            "unique_id": str(unique_id),
            "message": message,
            "status": status,
            "join_url": _pick(
                details,
                "JoinUrl", "joinUrl", "join_url", "MeetingLink", "meetingLink", "meeting_link",
                default="",
            ),
        }

    def send_attendance_details(self, unique_id: str, creator_email: Optional[str] = None) -> Dict[str, Any]:
        """
        Ask Classify for attendance + assets after the meeting ends.
        HTTP is often 200 even on business errors — inspect Status/Message.
        """
        email = (creator_email or self.creator_email or "").strip()
        if not email:
            raise ClassifyError(
                "CLASSIFY_CREATOR_EMAIL is not set (must be a Classify admin email)"
            )

        body = {
            "For": "meet",
            "for": "meet",
            "UniqueId": unique_id,
            "uniqueId": unique_id,
            "Product": self.product,
            "product": self.product,
            "Creator_email": email,
            "creator_email": email,
            # same auth token for triggering APIs
            "AuthToken": self.auth_token,
            "authToken": self.auth_token,
            "Org_id": self.org_id,
            "org_id": self.org_id,
        }

        last_err: Optional[Exception] = None
        resp: Dict[str, Any] = {}
        for path in (
            "/send-attendancedetails",
            "/send-attendance-details",
            "/SendAttendanceDetails",
            "/sendAttendanceDetails",
        ):
            try:
                resp = self._post(path, body)
                break
            except ClassifyError as e:
                last_err = e
                if "404" in str(e) or "405" in str(e):
                    continue
                raise
        else:
            raise ClassifyError(str(last_err or "SendAttendanceDetails failed"))

        status = str(_pick(resp, "Status", "status", default="") or "")
        message = str(_pick(resp, "Message", "message", default="") or "")
        session = _pick(resp, "SessionDetailsToSend", "sessionDetailsToSend", "sessionDetails")
        attendance = _pick(resp, "AttendanceDetails", "attendanceDetails", default=[]) or []

        msg_l = message.lower()
        retryable = (
            "in progress" in msg_l
            or "check back" in msg_l
            or status.startswith("409")
        )
        ok = status.startswith("200") and session is not None

        if not ok:
            raise ClassifyError(
                message or "Recording data not ready — try again after some time",
                status=status,
                retryable=retryable or status.startswith(("409", "500")) or not status.startswith("200"),
                payload=resp,
            )

        assets = []
        if isinstance(session, dict):
            assets = _pick(session, "AssetDetails", "assetDetails", "recordings", default=[]) or []

        recordings = []
        for asset in assets:
            if isinstance(asset, str) and asset.startswith("http"):
                recordings.append({"type": "recording", "url": asset})
                continue
            if not isinstance(asset, dict):
                continue

            # Docs shape: { type: "recording", url: "..." }
            # Live Classify shape: { recording: "https://...", chat: "", transcripts: "" }
            atype = str(_pick(asset, "type", "Type", default="") or "").lower()
            url = (
                _pick(
                    asset,
                    "url", "Url", "URL", "link", "Link",
                    "recording", "Recording", "recordingUrl", "RecordingUrl",
                    "video", "Video", "s3Url", "S3Url",
                    default="",
                )
                or ""
            )
            if not atype and _pick(asset, "recording", "Recording"):
                atype = "recording"
            url = str(url).strip()
            if url.startswith("http") and (
                atype in ("", "recording", "video") or "record" in atype
            ):
                recordings.append({"type": "recording", "url": url, "raw": asset})

        # Some payloads put recordings directly on session
        if not recordings and isinstance(session, dict):
            for key in ("recordings", "Recordings", "recordingLinks", "RecordingLinks"):
                raw_list = session.get(key) or []
                if isinstance(raw_list, list):
                    for item in raw_list:
                        if isinstance(item, str) and item.startswith("http"):
                            recordings.append({"type": "recording", "url": item})
                        elif isinstance(item, dict):
                            url = _pick(
                                item,
                                "url", "Url", "URL", "link",
                                "recording", "Recording",
                                default="",
                            )
                            if url:
                                recordings.append({"type": "recording", "url": url, "raw": item})

        if not recordings:
            logger.warning(
                "Classify attendance OK but no recording URLs parsed. asset sample=%s",
                (assets[:1] if assets else None),
            )
        return {
            "raw": resp,
            "session": session if isinstance(session, dict) else {},
            "attendance": attendance if isinstance(attendance, list) else [],
            "recordings": recordings,
            "minimum_attendance_time": _pick(
                session if isinstance(session, dict) else {},
                "MinimumAttendanceTime",
                "minimumAttendanceTime",
                "minimumAttendaceTime",  # typo in some Classify payloads
            ),
            "message": message,
            "status": status,
        }


classify_service = ClassifyService()
