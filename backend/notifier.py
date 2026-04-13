import smtplib
import os
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

class EmailNotifier:
    """
    Handles email notifications for AI-SRF framework.
    (Sikazwe, 2026)
    """
    def __init__(self):
        self.smtp_user = os.getenv("SMTP_USER")
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.dest_email = os.getenv("NOTIFICATION_EMAIL", "bryte.sika@gmail.com")
        self.smtp_server = "smtp.gmail.com"
        self.smtp_port = 587

    def send_governance_brief(self, ror_data: dict, risk_state: str, sector: str):
        """
        Sends an executive brief email after Stage 7 completion.
        """
        if not self.smtp_user or not self.smtp_password:
            print("[NOTIFIER] Skip sending email: SMTP credentials not set.")
            return False

        message = MIMEMultipart("alternative")
        message["Subject"] = f"AI-SRF Governance Alert: Stage 7 Complete ({risk_state})"
        message["From"] = self.smtp_user
        message["To"] = self.dest_email

        # Create the plain-text/html version of your message
        text = f"""
        AI-SRF DOCTORAL GOVERNANCE BRIEF
        --------------------------------
        Risk State: {risk_state}
        Sector: {sector}
        Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

        FINAL ROR INDICATORS:
        - Decision Latency (DLR): {ror_data.get('dlr_pct', 'N/A')}%
        - Decision Alpha (αD): {ror_data.get('decision_alpha', 'N/A')}
        - Sovereignty Yield (ASY): {ror_data.get('asy_pct', 'N/A')}%

        (Sikazwe, 2026)
        """
        
        html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
            <div style="background-color: #ffffff; padding: 40px; border-radius: 8px; max-width: 600px; margin: auto; border: 1px solid #ddd;">
                <h2 style="color: #A8401E; border-bottom: 2px solid #A8401E; padding-bottom: 10px;">AI-SRF Executive Brief</h2>
                <p><strong>Status:</strong> <span style="color: {'red' if risk_state == 'CRITICAL' else '#A8401E'}; font-weight: bold;">{risk_state}</span></p>
                <p><strong>Sector:</strong> {sector}</p>
                <p><strong>Date:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
                
                <div style="background-color: #f9f9f9; padding: 20px; border-radius: 4px; margin-top: 20px;">
                    <h3 style="margin-top: 0;">Final ROR Indicators</h3>
                    <ul style="list-style: none; padding: 0;">
                        <li><strong>Decision Latency (DLR):</strong> {ror_data.get('dlr_pct', 'N/A')}%</li>
                        <li><strong>Decision Alpha (αD):</strong> {ror_data.get('decision_alpha', 'N/A')}</li>
                        <li><strong>Sovereignty Yield (ASY):</strong> {ror_data.get('asy_pct', 'N/A')}%</li>
                    </ul>
                </div>
                
                <p style="font-size: 0.8em; color: #666; margin-top: 30px;">
                    This is an automated governance alert triggered by the AI-SRF Doctoral Framework.<br>
                    <em>Source: PhD Proposal, Bright Sikazwe (2026)</em>
                </p>
            </div>
        </body>
        </html>
        """

        part1 = MIMEText(text, "plain")
        part2 = MIMEText(html, "html")
        message.attach(part1)
        message.attach(part2)

        try:
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.sendmail(self.smtp_user, self.dest_email, message.as_string())
            print(f"[NOTIFIER] Email sent successfully to {self.dest_email}")
            return True
        except Exception as e:
            print(f"[NOTIFIER] Error sending email: {e}")
            return False
