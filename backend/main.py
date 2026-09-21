from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import client

from routes.auth_routes import router as auth_router
from routes.lead_routes import router as lead_router
from routes.bd_routes import router as bd_router
from routes.dashboard_routes import router as dashboard_router

app = FastAPI(
    title="BD Lead Routing System",
    description="Automatic lead routing based on language compatibility and BD availability",
    version="2.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(lead_router, prefix="/api/leads", tags=["Leads"])
app.include_router(bd_router, prefix="/api/bds", tags=["BDs"])
app.include_router(dashboard_router, prefix="/api", tags=["Dashboard"])

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
            "capacity_management": True
        }
    }

@app.on_event("shutdown")
async def shutdown_event():
    client.close()
