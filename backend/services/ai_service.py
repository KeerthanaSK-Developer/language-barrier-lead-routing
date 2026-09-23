import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Union

from config import AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

_KNOWN = {
    "english": "English",
    "tamil": "Tamil",
    "hindi": "Hindi",
    "telugu": "Telugu",
    "spanish": "Spanish",
    "french": "French",
    "german": "German",
    "kannada": "Kannada",
    "malayalam": "Malayalam",
    "marathi": "Marathi",
    "bengali": "Bengali",
    "gujarati": "Gujarati",
    "punjabi": "Punjabi",
    "urdu": "Urdu",
    "japanese": "Japanese",
    "mandarin": "Mandarin",
    "chinese": "Chinese",
    "arabic": "Arabic",
}


def normalize_language_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", (name or "").strip())
    if not cleaned:
        return ""
    known = _KNOWN.get(cleaned.lower())
    if known:
        return known
    return cleaned[:1].upper() + cleaned[1:] if cleaned else ""


def merge_languages(*groups: List[str]) -> List[str]:
    """Case-insensitive merge preserving first-seen casing/order."""
    out: List[str] = []
    seen = set()
    for group in groups:
        for raw in group or []:
            name = normalize_language_name(str(raw))
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(name)
    return out


def parse_transcription_data(raw: Any) -> Optional[Dict[str, Any]]:
    """
    Normalize to { callId, source, transcript }.
    Accepts dict, JSON string, or plain transcript text.
    """
    if raw is None:
        return None
    if isinstance(raw, dict):
        transcript = str(raw.get("transcript") or "").strip()
        if not transcript:
            return None
        transcript = transcript.replace("\\n", "\n")
        return {
            "callId": str(raw.get("callId") or raw.get("call_id") or "").strip(),
            "source": str(raw.get("source") or "transcript_content").strip() or "transcript_content",
            "transcript": transcript,
        }
    text = str(raw).strip()
    if not text:
        return None
    if text.startswith("{") and text.endswith("}"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parse_transcription_data(parsed)
        except json.JSONDecodeError:
            pass
    text = text.replace("\\n", "\n")
    return {
        "callId": "",
        "source": "transcript_content",
        "transcript": text,
    }


class AIService:
    def __init__(self):
        self.base_url = AI_BASE_URL
        self.api_key = AI_API_KEY
        self.model = AI_MODEL
        self.timeout = AI_TIMEOUT_SECONDS

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)

    def detect_languages_from_transcript(self, transcript: str) -> List[str]:
        """
        Detect spoken / mixed languages in a call transcript.
        Returns one or more language names (primary first).
        """
        text = (transcript or "").strip()
        if not text:
            return []
        if not self.is_configured:
            raise RuntimeError(
                "AI language detection is not configured. Set AI_API_KEY "
                "(and optionally AI_BASE_URL / AI_MODEL), or provide language explicitly."
            )

        system = (
            "You detect languages used in sales/support call transcripts. "
            "Transcripts may be fully in one language, or English mixed with Tamil/Hindi/etc. "
            "Return ONLY compact JSON with this shape: "
            '{"languages":["Tamil","English"],"primary":"Tamil"}. '
            "Use common English language names (Tamil, Hindi, English, Telugu, ...). "
            "Include every language clearly present. Put the learner's main language first in languages "
            "and as primary. No markdown, no explanation."
        )
        user = f"Transcript:\n{text[:8000]}"

        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "bd-lead-routing/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")
            logger.error("AI language detect HTTP %s: %s", e.code, err[:500])
            raise RuntimeError(f"Language detection failed (HTTP {e.code})") from e
        except Exception as e:
            logger.error("AI language detect failed: %s", e)
            raise RuntimeError(f"Language detection failed: {e}") from e

        content = (
            (((body.get("choices") or [{}])[0]).get("message") or {}).get("content")
            or ""
        )
        languages = self._parse_languages_payload(content)
        if not languages:
            raise RuntimeError("Language detection returned no languages")
        return languages

    def _parse_languages_payload(self, content: str) -> List[str]:
        text = (content or "").strip()
        if not text:
            return []
        # Strip optional markdown fences
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fence:
            text = fence.group(1).strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", text)
            if not match:
                return []
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                return []

        langs: List[str] = []
        if isinstance(parsed, dict):
            raw_list = parsed.get("languages") or []
            if isinstance(raw_list, list):
                langs.extend(str(x) for x in raw_list)
            primary = parsed.get("primary")
            if primary:
                langs = [str(primary)] + langs
        elif isinstance(parsed, list):
            langs = [str(x) for x in parsed]

        return merge_languages(langs)


def resolve_languages_with_transcript(
    explicit_languages: Optional[List[str]] = None,
    transcription: Any = None,
    *,
    require_any: bool = True,
) -> Dict[str, Any]:
    """
    Merge explicit languages with AI-detected languages from transcription.
    Returns { languages, transcriptionData, detected }.
    """
    explicit = merge_languages(explicit_languages or [])
    transcription_data = parse_transcription_data(transcription)
    detected: List[str] = []

    if transcription_data:
        detected = ai_service.detect_languages_from_transcript(transcription_data["transcript"])

    languages = merge_languages(explicit, detected)

    if require_any and not languages and not transcription_data:
        raise ValueError("Provide language and/or transcription")
    if require_any and not languages:
        raise ValueError("Could not determine language from transcription")

    return {
        "languages": languages,
        "transcriptionData": transcription_data,
        "detected": detected,
    }


ai_service = AIService()
