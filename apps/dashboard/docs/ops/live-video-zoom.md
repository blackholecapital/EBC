# EILA live video on Zoom

The dashboard's **Live Video Chat** tab can accept an existing Zoom participant
link or create a Zoom meeting through a Server-to-Server OAuth app. It then
creates an explicit LiveKit dispatch for the `lemonslice` agent with the Zoom
link in job metadata.

## Required Worker secrets

From `apps/dashboard`, run the interactive deployment helper:

```bash
bash scripts/deploy-live-video.sh
```

Wrangler prompts for each secret without storing it in shell history, then
deploys Everything Built Custom. The helper configures:

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `ZOOM_ACCOUNT_ID`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`

The three Zoom secrets are only required when Everything Built Custom creates a new meeting.
Dispatching EILA into an existing Zoom link only requires the two LiveKit
secrets.

The Zoom Server-to-Server OAuth app needs permission to create meetings for the
configured `ZOOM_USER_ID` (`me` by default).

## Agent contract

Everything Built Custom dispatches JSON metadata shaped like:

```json
{
  "meeting_url": "https://us05web.zoom.us/j/12345678901?pwd=...",
  "bot_name": "EILA · Everything Built Custom",
  "listen_to_meeting_chat": true
}
```

The matching EBC AI-AI LiveKit worker must call LemonSlice
`AvatarSession.join_meeting()` before starting the agent session. Regular web
avatar jobs without `meeting_url` continue using the browser LiveKit flow.
