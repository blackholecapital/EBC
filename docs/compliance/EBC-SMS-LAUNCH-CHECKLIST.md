# Everything Built Custom SMS launch checklist

The code contains consent gating for lead-triggered SMS, opt-out language in automated messages, and inbound STOP/START/HELP handling. That does not by itself constitute Twilio or carrier approval.

Before using EBC SMS beyond a controlled demonstration:

- Assign an EBC-only Twilio number; do not move a Black Hole or Buddy inbound webhook.
- Register the sending number under the appropriate Twilio messaging profile or A2P campaign.
- Publish Everything Built Custom Terms and Privacy pages that describe SMS use, frequency, message/data rates, STOP, and HELP.
- Use an unchecked, optional SMS-consent checkbox on the EBC lead form and store the consent text, timestamp, source URL, and phone number.
- Configure the EBC number's inbound webhook to `https://ebc-sms-worker.cryptocapitalgroupfl.workers.dev/twilio/inbound` and its status callback to the EBC SMS worker.
- Test START, STOP, HELP, wrong-number handling, and suppression before prospect outreach.

For today's controlled voice demonstration, use an EBC-only number if available and avoid unsolicited SMS. The existing dashboard is an operator tool, not evidence of public website opt-in.
