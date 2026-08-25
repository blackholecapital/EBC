# Everything Built Custom Voice Worker

Cloudflare channel adapter for Everything Built Custom AI voice calls.

## Realtime path

The worker originates Twilio calls, receives a bidirectional Media Stream, sends caller audio to Deepgram for transcription, and returns synthesized speech.

With `EILA_RUNTIME_STREAMING=true`, it sends conversational prompts to the self-hosted EILA Voice Runtime and forwards each returned 8 kHz mu-law audio chunk to Twilio immediately. Deterministic responses such as the greeting and estimate confirmation use the same streaming runtime.

If the EILA stream fails before audio starts, the Worker automatically falls back to the existing RunPod chat and OpenAI/Kokoro TTS path. It never starts a second response after partial EILA audio has already played.

## Required secrets

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` — use an EBC-only number
- `INTERNAL_CALL_SECRET` — identical on dashboard, concierge, and voice
- `DEEPGRAM_API_KEY`
- `BUDDY_RUNTIME_TOKEN`
- `EILA_RUNTIME_TOKEN` — optional during migration; falls back to `BUDDY_RUNTIME_TOKEN`
- `OPENAI_API_KEY` — legacy rollback TTS only after EILA is enabled

Set each secret against the default EBC target:

```bash
npx wrangler secret put OPENAI_API_KEY --config apps/voice-worker/wrangler.toml
```

## Deploy and verify

```bash
npx wrangler deploy --config apps/voice-worker/wrangler.toml
npx wrangler tail ebc-voice-worker
```

Expected progression:

1. Twilio call status reaches in-progress.
2. `Twilio media stream started` appears.
3. Deepgram connects and emits final transcript events.
4. With EILA enabled, the log reports `EILA streamed voice response sent` and `EILA streamed sales turn sent`, including `firstAudioMs`.
5. The stream close log reports audio and transcript counts.

## Rollback-safe EILA cutover

1. Boot `apps/eila-voice-runtime` on the GPU host and verify `/health` plus `/v1/speech`.
2. Set `EILA_RUNTIME_URL` to the stable RunPod proxy URL.
3. Set the same random runtime token on the GPU and Worker.
4. Change `EILA_RUNTIME_STREAMING` to `true` and deploy the Worker.
5. Run one complete call while tailing both services.
6. Roll back instantly by restoring `EILA_RUNTIME_STREAMING=false`; the previous path remains intact.

The RunPod URL may remain shared for controlled demos. Tenant context stays in the request contract so dedicated customer capacity can be introduced without forking the runtime.
