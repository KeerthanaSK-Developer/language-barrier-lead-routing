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
    "odia": "Odia",
    "oriya": "Odia",
    "assamese": "Assamese",
    "nepali": "Nepali",
    "sinhala": "Sinhala",
    "japanese": "Japanese",
    "korean": "Korean",
    "mandarin": "Mandarin",
    "chinese": "Chinese",
    "arabic": "Arabic",
    "portuguese": "Portuguese",
    "italian": "Italian",
    "russian": "Russian",
    "indonesian": "Indonesian",
    "malay": "Malay",
    "thai": "Thai",
    "vietnamese": "Vietnamese",
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

    def _chat_json(self, system: str, user: str, *, max_chars: int = 24000) -> Dict[str, Any]:
        if not self.is_configured:
            raise RuntimeError(
                "AI is not configured. Set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL)."
            )
        payload = {
            "model": self.model,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user[:max_chars]},
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
            with urllib.request.urlopen(req, timeout=max(self.timeout, 90)) as resp:
                body = json.loads(resp.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")
            logger.error("AI chat HTTP %s: %s", e.code, err[:500])
            raise RuntimeError(f"AI request failed (HTTP {e.code})") from e
        except Exception as e:
            logger.error("AI chat failed: %s", e)
            raise RuntimeError(f"AI request failed: {e}") from e

        content = (
            (((body.get("choices") or [{}])[0]).get("message") or {}).get("content")
            or ""
        )
        return self._parse_json_object(content)

    def _parse_json_object(self, content: str) -> Dict[str, Any]:
        text = (content or "").strip()
        if not text:
            return {}
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fence:
            text = fence.group(1).strip()
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {"raw": parsed}
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", text)
            if not match:
                return {"summary": text}
            try:
                parsed = json.loads(match.group(0))
                return parsed if isinstance(parsed, dict) else {"raw": parsed}
            except json.JSONDecodeError:
                return {"summary": text}

    def analyze_call_insights(
        self,
        transcript: str,
        *,
        lead_name: str = "",
        lead_email: str = "",
        preferred_language: str = "",
        attendance: Optional[List[Dict[str, Any]]] = None,
        session: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Produce BDA / BDM / marketing-oriented insights from a sales call transcript.
        """
        text = (transcript or "").strip()
        if not text:
            raise ValueError("Empty transcript")

        system = (
            "You analyze BD sales / counseling video-call transcripts for an edtech company. "
            "Transcripts may be in ANY language or mixed languages (Hindi, Tamil, Telugu, "
            "Malayalam, Kannada, English, Spanish, etc.) — judge fluency and content from "
            "what was actually said, not from English alone. "
            "Return ONLY compact JSON (no markdown) with this exact shape:\n"
            "{\n"
            '  "interested": true|false|null,\n'
            '  "interest_level": "high"|"medium"|"low"|"unknown"|"not_interested",\n'
            '  "interest_score": 0-100,\n'
            '  "join_probability": 0-100,\n'
            '  "summary": "2-4 sentence call summary for BDA follow-up",\n'
            '  "sentiment": "positive"|"neutral"|"negative"|"mixed",\n'
            '  "objections": ["..."],\n'
            '  "buying_signals": ["..."],\n'
            '  "pain_points": ["..."],\n'
            '  "preferred_courses_or_topics": ["..."],\n'
            '  "budget_or_pricing_mentions": ["..."],\n'
            '  "timeline": "when they might enroll / next step timing or empty",\n'
            '  "best_callback_time": "suggested callback window or empty",\n'
            '  "next_actions_for_bda": ["specific follow-ups for the BDA"],\n'
            '  "next_actions_for_bdm": ["coaching / escalation items"],\n'
            '  "marketing_insights": ["campaign / messaging / audience notes"],\n'
            '  "risk_flags": ["no-show risk, competitor, etc."],\n'
            '  "languages_detected": ["languages the LEARNER spoke fluently/comfortably"],\n'
            '  "languages_struggled": ["languages attempted where learner was NOT fluent"],\n'
            '  "language_barrier": true|false,\n'
            '  "language_barrier_reason": "why barrier exists or empty",\n'
            '  "sales_cooperation": "good"|"poor"|"unknown",\n'
            '  "cooperation_reason": "why poor/good or empty",\n'
            '  "lead_not_interested": true|false,\n'
            '  "not_interested_reason": "why lead is not interested or empty",\n'
            '  "key_quotes": ["short quotes"]\n'
            "}\n"
            "=== DECISION RULES (apply in order) ===\n"
            "1) LANGUAGE FLUENCY (content + fluency matter equally for every language):\n"
            "   - If the learner is fluent/comfortable in the language the BDA used → put that "
            "language in languages_detected; language_barrier=false.\n"
            "   - If the learner is NOT fluent in the BDA's language and cannot continue / "
            "cannot speak up properly → language_barrier=true; put that language in "
            "languages_struggled; leave languages_detected empty or only truly fluent langs. "
            "In language_barrier_reason state clearly that a different-language BDA is needed "
            "and name the lead preferred language from metadata when available "
            "(e.g. 'Learner struggled in English; prefers Hindi — reassign to Hindi BDA'). "
            "Do NOT set language_barrier when the transcript itself is garbled, incoherent, "
            "or clearly a bad speech-to-text result — that is a transcription quality issue, "
            "not proof the learner needs a different-language BDA. "
            "In that case set language_barrier=false and add a risk_flag about transcript quality. "
            "When preferred language is Tamil/Hindi/etc and the transcript is readable in that "
            "script or clearly conversational, assess fluency from content normally. "
            "2) BDA ENGAGEMENT: If the learner is willing/engaged (or trying to talk) but the "
            "BDA is not trying to engage, is dismissive, rushed, rude, or uncooperative → "
            "sales_cooperation=poor with a concrete cooperation_reason. "
            "If BDA communicates well and tries to engage → sales_cooperation=good.\n"
            "3) NOT INTERESTED: If the learner clearly does not want to enroll / continue "
            "(even when BDA communicates well) → interested=false, "
            "interest_level=not_interested, lead_not_interested=true, and write "
            "not_interested_reason (e.g. 'Lead declined; BDA communicated well').\n"
            "=== JOIN PROBABILITY ===\n"
            "join_probability = estimated % chance they enroll after this call. "
            "Lower it when: language barrier, poor BDA engagement, or lead not interested. "
            "Typical ranges: clear not-interested or hard barrier → 0-25; poor BDA engagement "
            "with otherwise warm lead → cut sharply vs content alone; strong interest + fluent "
            "call → higher. Use interest, objections, timeline, buying signals, and the "
            "rules above.\n"
            "Be factual; if unclear set interested to null and interest_level to unknown. "
            "Prefer actionable next_actions useful to BDA, BDM, and marketing."
        )
        meta_bits = []
        if lead_name:
            meta_bits.append(f"Lead name: {lead_name}")
        if lead_email:
            meta_bits.append(f"Lead email: {lead_email}")
        if preferred_language:
            meta_bits.append(f"Lead preferred language: {preferred_language}")
        if session:
            meta_bits.append(f"Session meta: {json.dumps(session, default=str)[:1500]}")
        if attendance:
            meta_bits.append(f"Attendance: {json.dumps(attendance, default=str)[:1500]}")
        user = (
            ("\n".join(meta_bits) + "\n\n" if meta_bits else "")
            + f"Transcript:\n{text}"
        )
        result = self._chat_json(system, user)
        # Normalize interested
        interested = result.get("interested")
        if interested is not None and not isinstance(interested, bool):
            s = str(interested).strip().lower()
            if s in ("true", "yes", "1", "interested"):
                result["interested"] = True
            elif s in ("false", "no", "0", "not_interested", "not interested"):
                result["interested"] = False
            else:
                result["interested"] = None
        # Normalize scores
        for key in ("interest_score", "join_probability"):
            raw = result.get(key)
            if raw is None:
                continue
            try:
                score = int(float(raw))
                result[key] = max(0, min(100, score))
            except (TypeError, ValueError):
                result[key] = None
        if result.get("join_probability") is None and isinstance(result.get("interest_score"), int):
            result["join_probability"] = result["interest_score"]
        # Normalize barrier / cooperation / not-interested
        lb = result.get("language_barrier")
        if not isinstance(lb, bool):
            s = str(lb or "").strip().lower()
            result["language_barrier"] = s in ("true", "yes", "1")
        coop = str(result.get("sales_cooperation") or "unknown").strip().lower()
        if coop not in ("good", "poor", "unknown"):
            coop = "unknown"
        result["sales_cooperation"] = coop
        lni = result.get("lead_not_interested")
        if not isinstance(lni, bool):
            s = str(lni or "").strip().lower()
            result["lead_not_interested"] = s in ("true", "yes", "1") or (
                result.get("interested") is False
                and str(result.get("interest_level") or "").lower() in (
                    "not_interested", "not interested", "none"
                )
            )
        if result.get("interested") is False:
            result["lead_not_interested"] = True
        # Normalize language lists (any language — English, Hindi, Tamil, etc.)
        for key in ("languages_detected", "languages_struggled"):
            raw_list = result.get(key)
            if not isinstance(raw_list, list):
                result[key] = []
                continue
            cleaned = []
            for item in raw_list:
                name = normalize_language_name(str(item or "").strip())
                if name and name not in cleaned:
                    cleaned.append(name)
            result[key] = cleaned
        # Fluent list must not also appear in struggled
        struggled_l = {x.lower() for x in result.get("languages_struggled") or []}
        result["languages_detected"] = [
            x for x in (result.get("languages_detected") or [])
            if x.lower() not in struggled_l
        ]
        # Soft caps so join % reflects barrier / poor engagement / not interested
        join = result.get("join_probability")
        if isinstance(join, int):
            if result.get("lead_not_interested"):
                join = min(join, 20)
            if result.get("language_barrier"):
                join = min(join, 30)
            if result.get("sales_cooperation") == "poor":
                join = min(join, 35)
            result["join_probability"] = max(0, join)
        return result


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
