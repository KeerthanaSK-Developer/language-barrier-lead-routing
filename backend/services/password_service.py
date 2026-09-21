import random
import string
import re
from config import COMPANY_DOMAIN

class PasswordService:
    """Service for generating and managing passwords."""
    
    @staticmethod
    def generate_password(name: str, phone: str) -> str:
        """Generate initial password based on pattern: {name_lower}{last_4_phone}_{random_3}."""
        name_clean = re.sub(r'[^a-zA-Z]', '', name).lower()
        phone_clean = re.sub(r'[^0-9]', '', phone)
        
        if len(phone_clean) >= 4:
            phone_suffix = phone_clean[-4:]
        else:
            phone_suffix = phone_clean.zfill(4)
        
        random_suffix = ''.join(random.choices(string.digits, k=3))
        
        password = f"{name_clean}{phone_suffix}_{random_suffix}"
        
        return password
    
    @staticmethod
    def generate_username(name: str) -> str:
        """Generate username/email from name."""
        name_clean = re.sub(r'[^a-zA-Z]', '', name).lower()
        return f"{name_clean}@{COMPANY_DOMAIN}"

# Global instance
password_service = PasswordService()
