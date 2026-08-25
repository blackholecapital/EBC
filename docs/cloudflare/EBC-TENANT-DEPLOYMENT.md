# Everything Built Custom Cloudflare tenant deployment

## Decision

Everything Built Custom is a dedicated production stack using the proven worker code, not a worker stack per shop or installer location. Because this repository belongs to Everything Built Custom, EBC resource names are the top-level Wrangler defaults. There is no production `blackhole-*` or `ace-*` target in its TOML files.

| Layer | EBC isolation | Shop/location model |
| --- | --- | --- |
| Dashboard | `ebc-dashboard-worker` | One corporate dashboard; filter by `locationId` |
| Orchestration | `ebc-concierge-worker` | Shared EBC workflows tagged by tenant/corporate/location |
| Channels | `ebc-voice-worker`, `ebc-sms-worker`, `ebc-email-worker` | Shared EBC channel capacity; no per-location worker copies |
| Transaction data | EBC-only dashboard and event D1 databases | Rows carry `tenantId`, `corporateId`, and `locationId` |
| Async work | EBC-only follow-up and communication queues | Messages carry the same scope fields |
| Archive | `ebc-call-center-archive` | Private prefixes under `tenants/ebc/` |
| Analytics | EBC-only Analytics Engine datasets | `tenantId` is the index; corporate/location are blobs |

This keeps the existing ACE and Black Hole workers and their data untouched and avoids deploying five workers for every shop. A separately operated business unit can later be promoted to its own repository or explicit Wrangler environment without changing the data contract.

## Deployment guardrail

`wrangler deploy` from this repository targets EBC workers only. Before any release, this command must return no matches:

```bash
rg 'name = "(blackhole|ace)-|service = "(blackhole|ace)-|queue = "(blackhole|ace)-|database_name = "(blackhole|ace)-' apps/*/wrangler.toml
```

The two D1 placeholders intentionally prevent a first production deployment until EBC databases have been created and their IDs copied into the TOMLs.

## Resource topology

```mermaid
flowchart TD
  P["EBC Pages"] --> D["EBC dashboard"]
  D --> C["EBC concierge"]
  C --> V["Voice / SMS / Email"]
  V --> Q["EBC communication queue"]
  Q --> D
  D --> S["EBC D1 + R2 + analytics"]
```

Cloudflare Queues allow multiple producers but only one active consumer for a queue. The EBC communication queue therefore has its own dashboard consumer and must not reuse the Black Hole communication queue.

## 1. Create the EBC resources

Run from the repository root with an authenticated Wrangler session:

```bash
npx wrangler d1 create ebc-call-center-dashboard
npx wrangler d1 create ebc-call-center-events
npx wrangler r2 bucket create ebc-call-center-archive

npx wrangler queues create ebc-followup-jobs
npx wrangler queues create ebc-followup-jobs-dlq
npx wrangler queues create ebc-communication-events
npx wrangler queues create ebc-communication-events-dlq
```

Copy the two D1 IDs printed by Wrangler into both affected TOML files:

| Placeholder | Replace in |
| --- | --- |
| `REPLACE_WITH_EBC_DASHBOARD_D1_ID` | `apps/dashboard/wrangler.toml` |
| `REPLACE_WITH_EBC_EVENTS_D1_ID` | `apps/dashboard/wrangler.toml`, `apps/blackhole-concierge-worker/wrangler.toml` |

Analytics Engine datasets are declared in the Wrangler environments and are created/connected during deployment.

## 2. Configure EBC secrets

Use `npx wrangler secret put NAME --config path/to/wrangler.toml`. The `INTERNAL_CALL_SECRET` value must be identical on dashboard, concierge, and voice.

| Worker | Secrets |
| --- | --- |
| Dashboard | `INTERNAL_CALL_SECRET` |
| Concierge | `INTERNAL_CALL_SECRET`, DocuSign credentials, Google Calendar credentials |
| Voice | `INTERNAL_CALL_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `DEEPGRAM_API_KEY`, runtime token, optional `OPENAI_API_KEY` |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Email | `RESEND_API_KEY`, `FROM_EMAIL` |

Example:

```bash
npx wrangler secret put INTERNAL_CALL_SECRET --config apps/voice-worker/wrangler.toml
```

Never place secret values in a TOML file or commit them to Git.

## 3. Deploy in dependency order

```bash
npx wrangler deploy --config apps/sms-worker/wrangler.toml
npx wrangler deploy --config apps/email-worker/wrangler.toml
npx wrangler deploy --config apps/voice-worker/wrangler.toml
npx wrangler deploy --config apps/blackhole-concierge-worker/wrangler.toml
npx wrangler deploy --config apps/dashboard/wrangler.toml

npm --prefix apps/frontend run build
npx wrangler pages deploy apps/frontend/dist --project-name ebc-call-center --config apps/frontend/wrangler.toml
```

The EBC voice environment uses the authenticated public concierge URL rather than a service binding. This removes the voice/concierge circular deployment dependency. Concierge-to-voice and dashboard-to-concierge remain private service bindings.

## 4. Configure provider callbacks

- Twilio voice status and stream URLs: the `ebc-voice-worker` URLs from its TOML.
- Twilio SMS status URL: the `ebc-sms-worker` URL from its TOML.
- DocuSign return/connect URLs: the `ebc-concierge-worker` URL.
- Lead form API: the EBC Pages site `/api/leads` endpoint.

## 5. Validate the tenant boundary

```bash
curl https://ebc-dashboard-worker.cryptocapitalgroupfl.workers.dev/api/health
curl https://ebc-concierge-worker.cryptocapitalgroupfl.workers.dev/api/health
curl https://ebc-voice-worker.cryptocapitalgroupfl.workers.dev/health
curl https://ebc-sms-worker.cryptocapitalgroupfl.workers.dev/api/health
curl https://ebc-email-worker.cryptocapitalgroupfl.workers.dev/api/health
```

Health output should report `tenantId: ebc`. Dashboard API responses also return `X-Tenant-Id`, `X-Corporate-Id`, and `X-Location-Id` headers.

Confirm that:

1. An EBC lead appears only in the EBC D1 databases.
2. Communication events reach `ebc-communication-events`, not `blackhole-communication-events`.
3. Analytics writes land in the `ebc_*` datasets.
4. Event archives appear under `tenants/ebc/events/` and signed PDFs under `tenants/ebc/documents/`.
5. Existing Black Hole health checks and queue depth remain unchanged.

## Adding shops or installer locations

Do not copy Wrangler environments for ordinary EBC shops or installer locations. Create each location in the EBC tenant data with a stable ID such as `clearwater-shop`; send that ID as `X-Location-Id` or `locationId`. Corporate users query all locations, while shop users are restricted to their permitted IDs at the application authorization layer.

Create a new Wrangler environment only when a corporate tenant requires one or more of:

- contractual data isolation;
- dedicated provider credentials or phone numbers;
- independent release timing;
- materially different capacity or compliance controls.

For that case, add `[env.<tenant-slug>]` consistently to every worker, change every worker/resource name and URL, provision new D1/Queue/R2 resources, and keep the same tenant/corporate/location event contract. Environment bindings are explicit and must all be repeated; never rely on production bindings to inherit.

## Live-video note

The dashboard's existing Zoom/live-video API has been retained. Its provider credentials and callbacks must be configured as EBC-owned secrets before activation; do not route EBC customer sessions through ACE or Black Hole provider resources.
