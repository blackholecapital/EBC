# Everything Built Custom AI Call Center

A dedicated sales, project-intake, and operations stack for [Everything Built Custom](https://everythingbuiltcustom.com/). This repository ports the proven ACE Call Center workflow to an EBC-only tenant while preserving the existing API and event contracts.

## First-pass experience

- EBC blue, navy, white, and charcoal branding with the live EBC wordmark and product imagery.
- A custom-cart lead tile that captures cart make, model, year, desired project, install preference, contact preference, and project notes.
- Product-aware voice discovery for power blocks, wire kits, fan kits, audio and LED upgrades, programming help, roofs, enclosures, and fully custom projects.
- A seven-stage pipeline: New Inquiry, Qualified, Build Review, Quote Sent, Approved, Fabrication, and Completed.
- Preliminary one-time estimates for published-price products, with compatibility review and human handoff for custom work.
- Existing Zoom/live-video, SMS, email, document, appointment, and conversation workflows retained.
- Male voice configured through the shared 6900 EILA/Chatterbox runtime, with OpenAI `onyx` as an optional fallback.

## Applications

| Path | Purpose |
| --- | --- |
| `apps/frontend` | EBC dashboard, project lead form, and operator surfaces |
| `apps/dashboard` | Contact, pipeline, event, document, appointment, and Zoom APIs |
| `apps/blackhole-concierge-worker` | EBC workflow orchestration and provider handoffs |
| `apps/voice-worker` | Twilio call flow, EBC product catalog, realtime AI, and TTS |
| `apps/sms-worker` | Dedicated EBC inbound/outbound SMS routing |
| `apps/email-worker` | Branded welcome, estimate, agreement, and appointment email |
| `apps/eila-voice-runtime` | Shared self-hosted realtime language and Chatterbox voice runtime |

## Local frontend

```bash
npm --prefix apps/frontend ci
npm --prefix apps/frontend run dev
```

## Deployment safety

The Wrangler targets in this repository are EBC-only. The D1 database IDs are intentional placeholders so a production deployment cannot accidentally write to another tenant. Provisioning, secrets, deployment order, and validation are documented in [the EBC Cloudflare runbook](docs/cloudflare/EBC-TENANT-DEPLOYMENT.md).

The activation pass includes pinned Wrangler tooling and repeatable commands:

```bash
npm ci
npm --prefix apps/frontend ci
npm run cf:provision
npm run cf:migrate
npm run cf:deploy
npm run cf:secrets
npm run cf:verify
```

The GitHub workflow stays disabled until the repository variable
`CLOUDFLARE_DEPLOY_ENABLED=true` is set after the first successful manual
deployment.

Production activation work is tracked in [NEXT-STEPS.md](NEXT-STEPS.md).
