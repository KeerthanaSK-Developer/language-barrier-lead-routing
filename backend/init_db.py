from passlib.context import CryptContext
from pymongo import MongoClient
from datetime import datetime
import random
import string
import os

# Add parent directory to path
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import MONGODB_URL, DATABASE_NAME, COMPANY_DOMAIN, COMPANY_NAME
from services.password_service import password_service

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def generate_password(name: str, phone: str) -> str:
    name_clean = ''.join(filter(str.isalpha, name)).lower()
    phone_clean = ''.join(filter(str.isdigit, phone))[-4:]
    random_suffix = ''.join(random.choices(string.digits, k=3))
    return f"{name_clean}{phone_clean}_{random_suffix}"

def init_database():
    client = MongoClient(MONGODB_URL)
    db = client[DATABASE_NAME]
    
    # Drop existing collections
    db.users.drop()
    db.bds.drop()
    db.leads.drop()
    db.routing_history.drop()
    db.pending_leads.drop()
    
    print("=" * 60)
    print("Initializing BD Lead Routing Database...")
    print("=" * 60)
    
    # ============================================
    # Create Admin Users (2)
    # ============================================
    admin_users = [
        {
            "name": "System Admin",
            "email": "admin@company.com",
            "phone": "9876543210",
            "role": "admin",
            "status": "active"
        },
        {
            "name": "Super Admin",
            "email": "superadmin@company.com",
            "phone": "9876543211",
            "role": "admin",
            "status": "active"
        }
    ]
    
    print("\n" + "=" * 60)
    print("CREDENTIALS FOR LOGIN (IMPORTANT - SAVE THESE!)")
    print("=" * 60)
    
    created_admins = []
    for admin in admin_users:
        password = generate_password(admin["name"], admin["phone"])
        hashed_password = pwd_context.hash(password)
        
        admin_user = {
            **admin,
            "password": hashed_password,
            "supported_languages": [],
            "created_at": datetime.utcnow()
        }
        result = db.users.insert_one(admin_user)
        admin_user["id"] = str(result.inserted_id)
        created_admins.append(admin_user)
        
        print(f"\nAdmin Account Created:")
        print(f"  Name: {admin['name']}")
        print(f"  Email: {admin['email']}")
        print(f"  Password: {password}")
        print(f"  Role: Admin")
    
    # ============================================
    # Create BD Users with their profiles
    # ============================================
    bd_users = [
        {
            "name": "Arun Kumar",
            "phone": "9876543220",
            "supported_languages": ["Tamil", "English", "Hindi"],
            "status": "active"
        },
        {
            "name": "David Smith",
            "phone": "9876543221",
            "supported_languages": ["English", "Spanish"],
            "status": "active"
        },
        {
            "name": "Priya Sharma",
            "phone": "9876543222",
            "supported_languages": ["Hindi", "English", "Telugu"],
            "status": "active"
        },
        {
            "name": "Michael Johnson",
            "phone": "9876543223",
            "supported_languages": ["English", "French", "German"],
            "status": "active"
        },
        {
            "name": "Lakshmi Devi",
            "phone": "9876543224",
            "supported_languages": ["Tamil", "Telugu"],
            "status": "active"
        }
    ]
    
    print("\n" + "-" * 60)
    print("BD Users (for testing):")
    print("-" * 60)
    
    for bd in bd_users:
        # Generate email from name
        email = password_service.generate_username(bd["name"])
        password = generate_password(bd["name"], bd["phone"])
        hashed_password = pwd_context.hash(password)
        
        # Create user
        bd_user = {
            "name": bd["name"],
            "email": email,
            "phone": bd["phone"],
            "role": "bd",
            "password": hashed_password,
            "supported_languages": bd["supported_languages"],
            "status": bd["status"],
            "created_at": datetime.utcnow()
        }
        result = db.users.insert_one(bd_user)
        user_id = str(result.inserted_id)
        
        # Create BD profile
        bd_profile = {
            "bd_id": user_id,
            "name": bd["name"],
            "email": email,
            "phone": bd["phone"],
            "supported_languages": bd["supported_languages"],
            "active_lead_count": 0,
            "status": "active",
            "availability": True
        }
        bds_result = db.bds.insert_one(bd_profile)
        
        print(f"\nBD Account Created:")
        print(f"  Name: {bd['name']}")
        print(f"  Email: {email}")
        print(f"  Password: {password}")
        print(f"  Languages: {', '.join(bd['supported_languages'])}")
    
    # ============================================
    # Create Sample Leads
    # ============================================
    sample_leads = [
        {
            "name": "Ravi Krishnan",
            "email": "ravi.krishnan@example.com",
            "phone": "9876543210",
            "preferred_language": "Tamil"
        },
        {
            "name": "Carlos Mendoza",
            "email": "carlos.mendoza@example.com",
            "phone": "9123456780",
            "preferred_language": "Spanish"
        },
        {
            "name": "Hans Mueller",
            "email": "hans.mueller@example.com",
            "phone": "9234567890",
            "preferred_language": "German"
        },
        {
            "name": "Sneha Reddy",
            "email": "sneha.reddy@example.com",
            "phone": "9345678901",
            "preferred_language": "Telugu"
        },
        {
            "name": "Claire Dubois",
            "email": "claire.dubois@example.com",
            "phone": "9456789012",
            "preferred_language": "French"
        },
        {
            "name": "Amit Verma",
            "email": "amit.verma@example.com",
            "phone": "9567890123",
            "preferred_language": "Hindi"
        },
        {
            "name": "Emily Watson",
            "email": "emily.watson@example.com",
            "phone": "9678901234",
            "preferred_language": "English"
        },
        {
            "name": "Meena Iyer",
            "email": "meena.iyer@example.com",
            "phone": "9789012345",
            "preferred_language": "Tamil"
        }
    ]
    
    for lead in sample_leads:
        lead["status"] = "new"
        lead["assigned_bd"] = None
        lead["created_at"] = datetime.utcnow()
        db.leads.insert_one(lead)
    
    print("\n" + "=" * 60)
    print(f"Database initialized successfully!")
    print(f"Created: 2 Admin users, {len(bd_users)} BD users, {len(sample_leads)} sample leads")
    print("=" * 60)
    
    print("\n" + "!" * 60)
    print("IMPORTANT: Email sending is DISABLED in this setup.")
    print("Configure SMTP settings in .env to enable email notifications.")
    print("!" * 60)

if __name__ == "__main__":
    init_database()
