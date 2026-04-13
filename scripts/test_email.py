import os
import sys
from dotenv import load_dotenv

# Add parent directory to path so we can import backend
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.notifier import EmailNotifier

def test_email():
    load_dotenv()
    
    print("--- AI-SRF Email Notification Test ---")
    
    notifier = EmailNotifier()
    
    if not notifier.smtp_user or not notifier.smtp_password:
        print("❌ Error: SMTP_USER or SMTP_PASSWORD not found in environment.")
        print("Please ensure you have created a .env file with your credentials.")
        return

    print(f"Sending test email from: {notifier.smtp_user}")
    print(f"Sending test email to: {notifier.dest_email}")
    
    test_ror = {
        "dlr_pct": 25.5,
        "decision_alpha": 0.85,
        "asy_pct": 92.0
    }
    
    success = notifier.send_governance_brief(test_ror, "ELEVATED", "Financial Services")
    
    if success:
        print("✅ Success! Check your inbox.")
    else:
        print("❌ Failed to send email. Check the error message above.")

if __name__ == "__main__":
    test_email()
