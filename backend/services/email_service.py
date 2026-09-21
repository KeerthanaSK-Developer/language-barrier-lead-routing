import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import (
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
    FROM_EMAIL, FRONTEND_URL, COMPANY_NAME
)

class EmailService:
    def __init__(self):
        self.smtp_host = SMTP_HOST
        self.smtp_port = SMTP_PORT
        self.smtp_user = SMTP_USER
        self.smtp_password = SMTP_PASSWORD
        self.from_email = FROM_EMAIL
    
    def send_email(self, to_email: str, subject: str, html_content: str) -> bool:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = self.from_email
            msg["To"] = to_email
            
            html_part = MIMEText(html_content, "html")
            msg.attach(html_part)
            
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.sendmail(self.from_email, to_email, msg.as_string())
            
            return True
        except Exception as e:
            print(f"Email sending failed: {str(e)}")
            return False
    
    def send_user_credentials(self, user_name: str, user_email: str, initial_password: str) -> bool:
        """Send login credentials to newly created user."""
        subject = f"Welcome to {COMPANY_NAME} - Your Account Details"
        
        html_content = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #2563eb;">Welcome to {COMPANY_NAME} Lead Routing System</h2>
                
                <p>Dear {user_name},</p>
                
                <p>Your account has been created. Please find your login credentials below:</p>
                
                <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Email:</strong> {user_email}</p>
                    <p><strong>Password:</strong> {initial_password}</p>
                </div>
                
                <p><a href="{FRONTEND_URL}/login" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Click here to login</a></p>
                
                <p style="color: #666; font-size: 14px;">
                    <strong>Important:</strong> Please change your password after your first login for security purposes.
                </p>
                
                <p>Best regards,<br>{COMPANY_NAME} Team</p>
            </div>
        </body>
        </html>
        """
        
        return self.send_email(user_email, subject, html_content)
    
    def send_lead_assignment_notification(self, bd_name: str, bd_email: str, lead_name: str, 
                                          lead_email: str, lead_phone: str, language: str, assigned_at: str) -> bool:
        """Send lead assignment notification to BD."""
        subject = f"New Lead Assigned: {lead_name}"
        
        html_content = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #2563eb;">New Lead Assigned to You</h2>
                
                <p>Dear {bd_name},</p>
                
                <p>A new lead has been automatically assigned to you. Please find the details below:</p>
                
                <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Lead Name:</strong> {lead_name}</p>
                    <p><strong>Email:</strong> {lead_email}</p>
                    <p><strong>Contact:</strong> {lead_phone}</p>
                    <p><strong>Preferred Language:</strong> {language}</p>
                    <p><strong>Assigned At:</strong> {assigned_at}</p>
                </div>
                
                <p><a href="{FRONTEND_URL}/my-leads" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Your Leads</a></p>
                
                <p>Please log in to the system to view more details and take action.</p>
                
                <p>Best regards,<br>{COMPANY_NAME} Lead Routing System</p>
            </div>
        </body>
        </html>
        """
        
        return self.send_email(bd_email, subject, html_content)

# Global instance
email_service = EmailService()
