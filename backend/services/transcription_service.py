"""Download Classify recordings → ffmpeg video→audio → local faster-whisper audio→text."""
from __future__ import annotations

import logging
import re
import shutil
import subprocess
import tempfile
import threading
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from config import (
    WHISPER_CHUNK_SECONDS,
    WHISPER_COMPUTE_TYPE,
    WHISPER_DEVICE,
    WHISPER_INDIC_CHUNK_SECONDS,
    WHISPER_MODEL_SIZE,
)

logger = logging.getLogger(__name__)

_model_lock = threading.Lock()
_model = None
_model_size_loaded: Optional[str] = None


class TranscriptionError(Exception):
    pass


def _ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg"))


# ISO-639-1 / whisper codes → display names used in the app (multilingual Whisper)
_WHISPER_LANG_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "ta": "Tamil",
    "te": "Telugu",
    "kn": "Kannada",
    "ml": "Malayalam",
    "mr": "Marathi",
    "bn": "Bengali",
    "gu": "Gujarati",
    "pa": "Punjabi",
    "ur": "Urdu",
    "or": "Odia",
    "as": "Assamese",
    "sa": "Sanskrit",
    "ne": "Nepali",
    "si": "Sinhala",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt": "Portuguese",
    "it": "Italian",
    "ru": "Russian",
    "ar": "Arabic",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "yue": "Cantonese",
    "id": "Indonesian",
    "ms": "Malay",
    "th": "Thai",
    "vi": "Vietnamese",
    "tr": "Turkish",
    "nl": "Dutch",
    "pl": "Polish",
    "uk": "Ukrainian",
    "fa": "Persian",
    "he": "Hebrew",
    "sw": "Swahili",
}

# Display / preferred names → Whisper language codes (force when auto-detect fails)
_NAME_TO_WHISPER_CODE = {
    "english": "en",
    "hindi": "hi",
    "tamil": "ta",
    "telugu": "te",
    "kannada": "kn",
    "malayalam": "ml",
    "marathi": "mr",
    "bengali": "bn",
    "bangla": "bn",
    "gujarati": "gu",
    "punjabi": "pa",
    "urdu": "ur",
    "odia": "or",
    "oriya": "or",
    "assamese": "as",
    "nepali": "ne",
    "sinhala": "si",
    "spanish": "es",
    "french": "fr",
    "german": "de",
    "portuguese": "pt",
    "italian": "it",
    "russian": "ru",
    "arabic": "ar",
    "japanese": "ja",
    "korean": "ko",
    "chinese": "zh",
    "mandarin": "zh",
    "cantonese": "yue",
    "indonesian": "id",
    "malay": "ms",
    "thai": "th",
    "vietnamese": "vi",
}

_INDIC_CODES = {"hi", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa", "ur", "or", "as", "ne", "si"}

# Unicode ranges for script sanity checks
_SCRIPT_RANGES = {
    "ta": (0x0B80, 0x0BFF),  # Tamil
    "hi": (0x0900, 0x097F),  # Devanagari
    "mr": (0x0900, 0x097F),
    "ne": (0x0900, 0x097F),
    "te": (0x0C00, 0x0C7F),  # Telugu
    "kn": (0x0C80, 0x0CFF),  # Kannada
    "ml": (0x0D00, 0x0D7F),  # Malayalam
    "bn": (0x0980, 0x09FF),  # Bengali
    "gu": (0x0A80, 0x0AFF),  # Gujarati
    "pa": (0x0A00, 0x0A7F),  # Gurmukhi
}

_INITIAL_PROMPTS = {
    "ta": "இது ஒரு கல்வி ஆலோசனை அழைப்பு. தமிழில் பேசுகிறார்கள்.",
    "hi": "यह एक शैक्षिक परामर्श कॉल है। हिंदी में बात हो रही है।",
    "te": "ఇది విద్యా సలహా కాల్. తెలుగులో మాట్లాడుతున్నారు.",
    "kn": "ಇದು ಶೈಕ್ಷಣಿಕ ಸಲಹೆ ಕರೆ. ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡುತ್ತಿದ್ದಾರೆ.",
    "ml": "ഇതൊരു വിദ്യാഭ്യാസ കൗൺസിലിംഗ് കോൾ ആണ്. മലയാളത്തിൽ സംസാരിക്കുന്നു.",
    "bn": "এটি একটি শিক্ষা পরামর্শ কল। বাংলায় কথা হচ্ছে।",
    "gu": "આ એક શૈક્ષણિક પરામર્શ કૉલ છે. ગુજરાતીમાં વાત થાય છે.",
    "mr": "ही एक शैक्षणिक सल्ला कॉल आहे. मराठीत बोलत आहेत.",
    "pa": "ਇਹ ਇੱਕ ਵਿਦਿਅਕ ਸਲਾਹ ਕਾਲ ਹੈ। ਪੰਜਾਬੀ ਵਿੱਚ ਗੱਲ ਹੋ ਰਹੀ ਹੈ।",
    "ur": "یہ ایک تعلیمی مشاورت کال ہے۔ اردو میں بات ہو رہی ہے۔",
}


def whisper_lang_to_name(code: Optional[str]) -> str:
    if not code:
        return ""
    key = str(code).strip().lower().split("-")[0]
    known = _WHISPER_LANG_NAMES.get(key)
    if known:
        return known
    cleaned = key.strip()
    return cleaned[:1].upper() + cleaned[1:] if cleaned else ""


def language_name_to_whisper_code(name: Optional[str]) -> Optional[str]:
    """Map 'Tamil' / 'ta' / 'tamil' → Whisper ISO code, or None."""
    if not name:
        return None
    raw = str(name).strip().lower()
    if not raw:
        return None
    if raw in _WHISPER_LANG_NAMES:
        return raw
    key = raw.split("-")[0].split("_")[0]
    if key in _WHISPER_LANG_NAMES:
        return key
    return _NAME_TO_WHISPER_CODE.get(raw) or _NAME_TO_WHISPER_CODE.get(key)


def _get_whisper_model():
    """Lazy-load a single WhisperModel (downloads weights on first use)."""
    global _model, _model_size_loaded
    size = (WHISPER_MODEL_SIZE or "medium").strip()
    if _model is not None and _model_size_loaded == size:
        return _model
    with _model_lock:
        if _model is not None and _model_size_loaded == size:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            raise TranscriptionError(
                "faster-whisper is not installed. Add it to requirements and rebuild the backend."
            ) from e
        device = WHISPER_DEVICE or "cpu"
        compute = WHISPER_COMPUTE_TYPE or "int8"
        logger.info(
            "Loading local Whisper model=%s device=%s compute_type=%s",
            size,
            device,
            compute,
        )
        try:
            _model = WhisperModel(size, device=device, compute_type=compute)
            _model_size_loaded = size
        except Exception as e:
            raise TranscriptionError(f"Failed to load Whisper model '{size}': {e}") from e
        return _model


def _script_char_ratio(text: str, lang_code: Optional[str]) -> float:
    """Fraction of letters that fall in the expected Indic script range."""
    if not text or not lang_code:
        return 0.0
    bounds = _SCRIPT_RANGES.get(lang_code)
    if not bounds:
        return 1.0  # no check
    lo, hi = bounds
    letters = [c for c in text if c.isalpha() or ("\u0900" <= c <= "\u0D7F")]
    if not letters:
        return 0.0
    hits = sum(1 for c in letters if lo <= ord(c) <= hi)
    return hits / max(1, len(letters))


def _collapse_repetitions(text: str) -> str:
    """Remove Whisper hallucination loops (same phrase repeated many times)."""
    if not text or len(text) < 40:
        return text
    # Collapse exact consecutive sentence/phrase repeats
    parts = [p.strip() for p in text.replace("\n", " ").split() if p.strip()]
    if len(parts) < 8:
        return text
    # Word-level: drop runs of the same 3–12 gram repeated 3+ times
    out: List[str] = []
    i = 0
    n = len(parts)
    while i < n:
        collapsed = False
        for size in range(12, 2, -1):
            if i + size * 3 > n:
                continue
            gram = parts[i : i + size]
            repeats = 1
            j = i + size
            while j + size <= n and parts[j : j + size] == gram:
                repeats += 1
                j += size
            if repeats >= 3:
                out.extend(gram)
                i = j
                collapsed = True
                break
        if not collapsed:
            out.append(parts[i])
            i += 1
    cleaned = " ".join(out)
    cleaned = re.sub(r"(.{8,80}?)(?:\s*\1){3,}", r"\1", cleaned)
    return cleaned.strip()


def _looks_garbled(text: str, lang_code: Optional[str]) -> bool:
    """Heuristic: repetitive loops or missing expected Indic script."""
    if not text or len(text.strip()) < 20:
        return True
    collapsed = _collapse_repetitions(text)
    # Massive shrink after collapsing loops → was mostly repetition
    if len(text) > 200 and len(collapsed) < len(text) * 0.4:
        return True
    if lang_code in _SCRIPT_RANGES:
        ratio = _script_char_ratio(text, lang_code)
        if ratio < 0.15 and len(text) > 80:
            return True
    # Same 20+ char window repeating
    sample = text[:400]
    for n in (20, 30, 40):
        if len(sample) < n * 3:
            continue
        chunk = sample[:n]
        if text.count(chunk) >= 4:
            return True
    return False


def download_file(url: str, dest: Path, timeout: int = 300) -> Path:
    req = urllib.request.Request(url, headers={"User-Agent": "bd-lead-routing/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as f:
            shutil.copyfileobj(resp, f)
    except Exception as e:
        raise TranscriptionError(f"Failed to download recording: {e}") from e
    if not dest.exists() or dest.stat().st_size == 0:
        raise TranscriptionError("Downloaded recording is empty")
    return dest


def extract_audio_chunks(media_path: Path, work_dir: Path, chunk_seconds: int) -> List[Path]:
    """
    ffmpeg: video/audio → mono 16kHz wav, then split into ~chunk_seconds pieces.
    """
    if not _ffmpeg_available():
        raise TranscriptionError(
            "ffmpeg is not installed. Install ffmpeg to transcribe Classify recordings."
        )

    full_wav = work_dir / "full.wav"
    cmd = [
        "ffmpeg", "-y", "-i", str(media_path),
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav",
        str(full_wav),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=600)
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="replace")[:400]
        raise TranscriptionError(f"ffmpeg audio extract failed: {err}") from e
    except Exception as e:
        raise TranscriptionError(f"ffmpeg audio extract failed: {e}") from e

    if not full_wav.exists() or full_wav.stat().st_size == 0:
        raise TranscriptionError("No audio track found in recording")

    pattern = str(work_dir / "chunk_%03d.wav")
    split_cmd = [
        "ffmpeg", "-y", "-i", str(full_wav),
        "-f", "segment", "-segment_time", str(max(30, chunk_seconds)),
        "-c", "copy", pattern,
    ]
    try:
        subprocess.run(split_cmd, check=True, capture_output=True, timeout=600)
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="replace")[:400]
        raise TranscriptionError(f"ffmpeg chunk split failed: {err}") from e

    chunks = sorted(work_dir.glob("chunk_*.wav"))
    if not chunks:
        return [full_wav]
    return chunks


def _resolve_whisper_language(
    audio_path: Path,
    *,
    language_hint: Optional[str] = None,
) -> Tuple[Optional[str], str]:
    """
    Choose Whisper language code.

    Auto-detect often labels clear Tamil/Hindi as English → Latin garble.
    For Indic preferred languages, always force the hint (much more reliable than detect).
    """
    hint = language_name_to_whisper_code(language_hint)
    if hint and hint in _INDIC_CODES:
        logger.info(
            "Forcing Whisper language=%s from preferred/hint for %s (Indic)",
            hint, audio_path.name,
        )
        return hint, "hint_indic"

    if hint and hint != "en":
        # Non-English non-Indic hint (e.g. Spanish) — still prefer hint over mis-detect
        logger.info(
            "Using Whisper language=%s from preferred/hint for %s",
            hint, audio_path.name,
        )
        return hint, "hint"

    # English preferred or no hint — let Whisper auto-detect (handles mixed calls)
    return None, "auto"


def _run_whisper_once(
    model,
    audio_path: Path,
    *,
    lang_code: Optional[str],
    vad_filter: bool,
    temperature,
    beam_size: int,
) -> Tuple[str, Optional[str]]:
    is_indic = (lang_code or "") in _INDIC_CODES
    kwargs: Dict[str, Any] = dict(
        beam_size=beam_size,
        language=lang_code,
        task="transcribe",
        condition_on_previous_text=False,
        compression_ratio_threshold=2.2 if is_indic else 2.4,
        log_prob_threshold=-0.8 if is_indic else -1.0,
        no_speech_threshold=0.6,
        temperature=temperature,
        vad_filter=vad_filter,
        initial_prompt=_INITIAL_PROMPTS.get(lang_code or "") if is_indic else None,
    )
    if vad_filter:
        kwargs["vad_parameters"] = dict(
            min_silence_duration_ms=500,
            speech_pad_ms=400,
            threshold=0.45,
        )
    segments, info = model.transcribe(str(audio_path), **kwargs)
    parts = [seg.text.strip() for seg in segments if seg.text and seg.text.strip()]
    text = " ".join(parts).strip()
    out_code = getattr(info, "language", None) or lang_code
    return text, str(out_code) if out_code else None


def whisper_transcribe_file(
    audio_path: Path,
    *,
    language_hint: Optional[str] = None,
    force_language: Optional[str] = None,
) -> Dict[str, Any]:
    """Local faster-whisper: audio → text. Indic: force language, short-safe settings, anti-loop retry."""
    model = _get_whisper_model()
    try:
        if force_language:
            lang_code = language_name_to_whisper_code(force_language) or force_language
            resolve_how = "forced"
        else:
            lang_code, resolve_how = _resolve_whisper_language(
                audio_path, language_hint=language_hint
            )

        is_indic = (lang_code or "") in _INDIC_CODES
        # Pass 1: Indic without VAD (VAD often chops Tamil poorly) + forced language
        text, out_code = _run_whisper_once(
            model,
            audio_path,
            lang_code=lang_code,
            vad_filter=not is_indic,
            temperature=0.0,
            beam_size=8 if is_indic else 5,
        )
        text = _collapse_repetitions(text)

        # Pass 2: if garbled / looping, retry with alternate temperature + VAD flipped
        if is_indic and _looks_garbled(text, lang_code):
            logger.warning(
                "Indic transcript looks garbled for %s (lang=%s) — retrying",
                audio_path.name, lang_code,
            )
            text2, out_code2 = _run_whisper_once(
                model,
                audio_path,
                lang_code=lang_code,
                vad_filter=True,
                temperature=[0.0, 0.2, 0.4],
                beam_size=5,
            )
            text2 = _collapse_repetitions(text2)
            # Prefer the version with better script ratio / less repetition
            r1 = _script_char_ratio(text, lang_code)
            r2 = _script_char_ratio(text2, lang_code)
            if r2 > r1 or (not _looks_garbled(text2, lang_code) and _looks_garbled(text, lang_code)):
                text, out_code = text2, out_code2
                resolve_how = f"{resolve_how}+retry"

        text = _collapse_repetitions(text)
        lang_name = whisper_lang_to_name(out_code or lang_code)
        logger.info(
            "Whisper language=%s (%s) via=%s hint=%s model=%s for %s chars=%s script_ratio=%.2f garbled=%s",
            out_code or lang_code,
            lang_name,
            resolve_how,
            language_hint or "",
            _model_size_loaded or WHISPER_MODEL_SIZE,
            audio_path.name,
            len(text),
            _script_char_ratio(text, lang_code),
            _looks_garbled(text, lang_code),
        )
        return {
            "text": text,
            "language": lang_name,
            "language_code": out_code or lang_code,
            "language_resolve": resolve_how,
            "garbled": _looks_garbled(text, lang_code),
        }
    except TranscriptionError:
        raise
    except Exception as e:
        raise TranscriptionError(f"Local Whisper failed on {audio_path.name}: {e}") from e


def transcribe_recording_url(
    url: str,
    *,
    chunk_seconds: Optional[int] = None,
    language_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Download recording → ffmpeg to wav chunks → local Whisper → concatenated transcript.

    language_hint: lead preferred (e.g. "Tamil"). Indic uses short chunks to avoid loops.
    """
    hint_code = language_name_to_whisper_code(language_hint)
    is_indic = (hint_code or "") in _INDIC_CODES
    if chunk_seconds is None:
        secs = WHISPER_INDIC_CHUNK_SECONDS if is_indic else WHISPER_CHUNK_SECONDS
    else:
        secs = chunk_seconds
    # Cap Indic chunks — long windows → repetitive hallucinations
    if is_indic:
        secs = min(max(20, secs), 60)

    with tempfile.TemporaryDirectory(prefix="call_rec_") as tmp:
        work = Path(tmp)
        ext = ".mp4"
        lower = url.lower().split("?")[0]
        for candidate in (".mp4", ".webm", ".mkv", ".mov", ".m4a", ".mp3", ".wav"):
            if lower.endswith(candidate):
                ext = candidate
                break
        media = work / f"recording{ext}"
        download_file(url, media)
        chunks = extract_audio_chunks(media, work, secs)
        logger.info(
            "Transcribe url hint=%s indic=%s chunk_secs=%s n_chunks=%s",
            language_hint or "", is_indic, secs, len(chunks),
        )
        parts_out: List[Dict[str, Any]] = []
        texts: List[str] = []
        languages: List[str] = []
        first_lang_code: Optional[str] = None
        for i, chunk in enumerate(chunks):
            logger.info(
                "Transcribing chunk %s/%s (%s) hint=%s",
                i + 1, len(chunks), chunk.name, language_hint or "",
            )
            if i == 0:
                result = whisper_transcribe_file(chunk, language_hint=language_hint)
                first_lang_code = result.get("language_code")
            else:
                result = whisper_transcribe_file(
                    chunk,
                    language_hint=language_hint,
                    force_language=first_lang_code or language_hint,
                )
            text = result.get("text") or ""
            lang = result.get("language") or ""
            parts_out.append({
                "index": i,
                "text": text,
                "language": lang,
                "language_code": result.get("language_code"),
                "language_resolve": result.get("language_resolve"),
                "garbled": result.get("garbled"),
            })
            if text:
                texts.append(text)
            if lang and lang not in languages:
                languages.append(lang)
        transcript = _collapse_repetitions("\n\n".join(texts).strip())
        if not transcript:
            raise TranscriptionError("Whisper returned empty transcript for all chunks")
        return {
            "transcript": transcript,
            "chunks": parts_out,
            "source_url": url,
            "chunk_count": len(parts_out),
            "languages": languages,
            "language_hint": language_hint,
            "chunk_seconds": secs,
        }


def transcribe_recording_urls(
    urls: List[str],
    *,
    language_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """Transcribe multiple recordings; concatenate with separators."""
    all_chunks: List[Dict[str, Any]] = []
    texts: List[str] = []
    for i, url in enumerate(urls):
        if not url:
            continue
        result = transcribe_recording_url(url, language_hint=language_hint)
        texts.append(result["transcript"])
        for ch in result["chunks"]:
            all_chunks.append({**ch, "recording_index": i, "source_url": url})
    if not texts:
        raise TranscriptionError("No recording URLs to transcribe")
    return {
        "transcript": "\n\n---\n\n".join(texts),
        "chunks": all_chunks,
        "recording_count": len(texts),
    }
