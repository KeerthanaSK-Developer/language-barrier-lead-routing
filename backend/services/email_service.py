import json
import logging
import smtplib
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import (
    RESEND_API_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
    FROM_EMAIL, FRONTEND_URL, COMPANY_NAME
)

logger = logging.getLogger(__name__)

# Keep email off the request/event-loop path. SMTP can hang for minutes
# without a timeout and would freeze the whole API (async routes + sync SMTP).
_email_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="email")
SMTP_TIMEOUT_SECONDS = 15
RESEND_API_URL = "https://api.resend.com/emails"


class EmailService:
    def __init__(self):
        self.resend_api_key = RESEND_API_KEY
        self.smtp_host = SMTP_HOST
        self.smtp_port = SMTP_PORT
        self.smtp_user = SMTP_USER
        self.smtp_password = SMTP_PASSWORD
        self.from_email = FROM_EMAIL

    @property
    def transport(self) -> str:
        if self.resend_api_key:
            return "resend"
        if self.smtp_user and self.smtp_password:
            return "smtp"
        return "none"

    @property
    def is_configured(self) -> bool:
        return self.transport != "none"

    def send_email(self, to_email: str, subject: str, html_content: str) -> bool:
        if not self.is_configured:
            logger.warning("Email not configured; skipping send to %s", to_email)
            return False

        if self.transport == "resend":
            return self._send_via_resend(to_email, subject, html_content)
        return self._send_via_smtp(to_email, subject, html_content)

    def _send_via_resend(self, to_email: str, subject: str, html_content: str) -> bool:
        """HTTPS email API — works on all Railway plans (SMTP is Hobby-blocked)."""
        payload = {
            "from": f"{COMPANY_NAME} <{self.from_email}>",
            "to": [to_email],
            "subject": subject,
            "html": html_content,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            RESEND_API_URL,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.resend_api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=SMTP_TIMEOUT_SECONDS) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                logger.info("Resend accepted email to %s: %s", to_email, body[:200])
                return True
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            logger.error("Resend failed to %s: HTTP %s %s", to_email, e.code, err_body)
            return False
        except Exception as e:
            logger.error("Resend failed to %s: %s", to_email, e)
            return False

    def _send_via_smtp(self, to_email: str, subject: str, html_content: str) -> bool:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = self.from_email
            msg["To"] = to_email

            html_part = MIMEText(html_content, "html")
            msg.attach(html_part)

            with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=SMTP_TIMEOUT_SECONDS) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.sendmail(self.from_email, to_email, msg.as_string())

            logger.info("SMTP accepted email to %s", to_email)
            return True
        except Exception as e:
            logger.error("SMTP failed to %s: %s", to_email, e)
            return False

    def send_email_background(self, to_email: str, subject: str, html_content: str) -> bool:
        """Queue email send; never blocks the caller. Returns False if not configured."""
        if not self.is_configured:
            logger.warning("Email not configured; skipping email to %s", to_email)
            return False

        def _run():
            try:
                self.send_email(to_email, subject, html_content)
            except Exception as e:
                logger.error("Background email failed to %s: %s", to_email, e)

        _email_executor.submit(_run)
        return True

    def send_user_credentials(self, user_name: str, user_email: str, initial_password: str) -> bool:
        """Queue login credentials email (non-blocking)."""
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

        return self.send_email_background(user_email, subject, html_content)

    def send_lead_assignment_notification(self, bd_name: str, bd_email: str, lead_name: str,
                                          lead_email: str, lead_phone: str, language: str, assigned_at: str) -> bool:
        """Queue lead-assignment notification (non-blocking)."""
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

        return self.send_email_background(bd_email, subject, html_content)


# Global instance
email_service = EmailService()
