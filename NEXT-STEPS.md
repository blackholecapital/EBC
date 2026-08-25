# EBC activation plan

## Pass 2 — provision and connect

- [ ] Create EBC-only D1 databases, R2 archive bucket, queues, and Analytics Engine datasets.
- [ ] Replace the two guarded D1 ID placeholders in the Wrangler files.
- [ ] Configure the shared internal-call secret across dashboard, concierge, and voice workers.
- [ ] Add EBC Twilio, Resend, DocuSign, Google Calendar, Deepgram, and runtime credentials.
- [ ] Assign the production EBC voice/SMS number and configure Twilio callbacks.
- [ ] Record or select the approved male EBC Chatterbox reference voice for the 6900 runtime.
- [ ] Deploy workers in dependency order, then publish the EBC Pages frontend.

## Pass 3 — end-to-end acceptance

- [ ] Submit a project lead for each major product category and confirm EBC-only persistence.
- [ ] Validate make/model/year and compatibility notes through dashboard, events, email, and transcripts.
- [ ] Test inbound and outbound calls, SMS consent/STOP handling, branded email, and call-now links.
- [ ] Test preliminary estimate generation for fixed-price products and specialist handoff for custom builds.
- [ ] Launch and complete a Zoom/live-video consultation from a lead.
- [ ] Approve and reschedule a build consultation; verify customer notifications and calendar events.
- [ ] Verify documents, R2 archive paths, queue retries/dead letters, analytics, and health endpoints.
- [ ] Confirm no event, queue, database, or archive writes touch ACE or Black Hole resources.

## Pass 4 — launch hardening

- [ ] Add authentication and EBC operator roles before exposing the dashboard.
- [ ] Publish an EBC privacy policy and link it from the lead form before enabling SMS collection.
- [ ] Have EBC approve catalog copy, starting prices, compatibility disclaimers, logo usage, and voice persona.
- [ ] Replace demo leads with an empty production state or an approved seeded demo workspace.
- [ ] Set production domains, monitoring, alerting, backups, data retention, and rollback checks.
- [ ] Run a supervised live pilot and review transcripts, lead scores, quote accuracy, and handoff quality.

## Inputs required from EBC

- Production phone number and desired caller ID name.
- Approved sender email/domain and reply-to address.
- Hours, service area, install/shipping rules, escalation contact, and calendar owner.
- Final product/variant matrix, compatibility rules, lead times, tax/shipping policy, and price authority.
- Approved male voice reference or permission to use the configured fallback voice.
- Privacy-policy URL and finalized SMS consent language.
