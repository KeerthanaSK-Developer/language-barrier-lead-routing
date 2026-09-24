import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import client
from config import CORS_ORIGINS
from services.email_service import email_service
from services.call_fetch_scheduler import start_scheduler, stop_scheduler

from routes.auth_routes import router as auth_router
from routes.lead_routes import router as lead_router
from routes.bd_routes import router as bd_router
from routes.dashboard_routes import router as dashboard_router
from routes.call_routes import router as call_router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="BD Lead Routing System",
    description="Automatic lead routing based on language compatibility and BD availability",
    version="2.0.0"
)

# CORS: cannot use allow_origins=["*"] with allow_credentials=True
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(lead_router, prefix="/api/leads", tags=["Leads"])
app.include_router(bd_router, prefix="/api/bds", tags=["BDs"])
app.include_router(dashboard_router, prefix="/api", tags=["Dashboard"])
app.include_router(call_router, prefix="/api/calls", tags=["Calls"])


@app.get("/")
async def root():
    return {
        "message": "BD Lead Routing API",
        "version": "2.0.0",
        "docs": "/docs",
        "features": {
            "automatic_routing": True,
            "bulk_upload": True,
            "email_notifications": True,
            "pending_leads": True,
            "capacity_management": True,
            "call_manual_fetch": True,
            "call_scheduled_fetch_end_plus_5_10": True,
        }
    }

@app.on_event("startup")
async def startup_event():
    transport = email_service.transport
    if transport == "brevo":
        logger.info("Email transport: Brevo HTTPS API (Railway-compatible)")
    elif transport == "smtp":
        logger.info(
            "Email transport: SMTP %s (works locally; blocked on Railway Hobby/Free — set BREVO_API_KEY)",
            email_service.smtp_host,
        )
    else:
        logger.warning(
            "Email not configured — set BREVO_API_KEY (recommended on Railway) "
            "or SMTP_USER/SMTP_PASSWORD. Emails will be skipped."
        )
    try:
        start_scheduler()
    except Exception:
        logger.exception("Call fetch scheduler failed to start")


@app.on_event("shutdown")
async def shutdown_event():
    stop_scheduler()
    client.close()
