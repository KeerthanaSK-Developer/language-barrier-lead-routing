import os
from dotenv import load_dotenv

load_dotenv()

# MongoDB
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = "bd_lead_routing"

# JWT
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set. Add it to backend/.env (see backend/.env.example)."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours

# Password Generation Pattern
# Pattern: {name_lower}{last_4_phone}_{random_3_digits}
PASSWORD_PATTERN = os.getenv("PASSWORD_PATTERN", "name_phone_random")
PASSWORD_RANDOM_LENGTH = int(os.getenv("PASSWORD_RANDOM_LENGTH", "3"))

# Email Settings
# Railway Hobby/Free blocks outbound SMTP — use BREVO_API_KEY (HTTPS) in production.
# Priority: BREVO_API_KEY > SMTP (local only).
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "").strip()
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "noreply@company.com")
FROM_NAME = os.getenv("FROM_NAME", "").strip() or os.getenv("COMPANY_NAME", "Company")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

# Comma-separated extra origins, e.g. https://my-app.up.railway.app
_extra_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
CORS_ORIGINS = list(dict.fromkeys([
    FRONTEND_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    *_extra_origins,
]))

# BD Capacity
MAX_ACTIVE_LEADS_PER_BD = int(os.getenv("MAX_ACTIVE_LEADS_PER_BD", "3"))

# Company Settings
COMPANY_NAME = os.getenv("COMPANY_NAME", "Company")
COMPANY_DOMAIN = os.getenv("COMPANY_DOMAIN", "company.com")

# AI (OpenAI-compatible — Hyrenet / Claude). Used for transcript language detection.
# Do not use Bedrock.
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://ai.hyrenet-staging.in/v1").rstrip("/")
AI_API_KEY = os.getenv("AI_API_KEY", "").strip()
AI_MODEL = os.getenv("AI_MODEL", "global.anthropic.claude-sonnet-4-6").strip()
AI_TIMEOUT_SECONDS = int(os.getenv("AI_TIMEOUT_SECONDS", "45"))
