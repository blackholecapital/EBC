# EBC repository boundary

This repository is an isolated Everything Built Custom product module. EBC changes must remain inside `blackholecapital/EBC` and EBC-named deployment resources.

## Hard rules for agents

- Never edit, commit to, open a pull request against, or require a code change in `blackholecapital/cloudflare-platform` for EBC work. That repository is deployment infrastructure and is outside EBC's authorization boundary.
- Never modify AI Fans, Buddy's, EILA/LS Overwatch, ACE, or another product repository to implement an EBC feature. Those repositories may be inspected read-only as architectural references.
- Do not add service bindings to another product's Workers. EBC Workers, queues, databases, buckets, datasets, agents, and service bindings must use EBC-owned names.
- Account-level Cloudflare Secrets Store entries may be consumed by name from EBC Wrangler files. Consuming an existing deployment secret does not authorize changing the deployment platform or another repository.
- If an EBC feature appears to require a cross-repository code change, stop and ask the owner. The default implementation is an EBC-owned adapter inside this repository.

For the deploy topology and verification commands, read `docs/cloudflare/EBC-TENANT-DEPLOYMENT.md`.


## Frozen shared voice/video pipeline

EBC owns its UI, APIs, data, tenant adapter, and EBC-named deployment targets. It consumes shared compute only through the existing tenant contract:

```text
EBC UI
  -> EBC API / tenant adapter
  -> existing shared session broker contract
  -> LiveKit room
  -> shared avatar worker
  -> shared voice runtime
  -> shared LLM / TTS resources
```

Adding or changing EBC's tenant, voice, avatar, or prompt is an EBC adapter/configuration operation. It must not restart, clone, or rewrite the shared runtime.

### Additional prohibitions

- Do not modify the shared Windows/WSL runtime, EILA Overwatch, LiveKit avatar worker, voice runtime, Ollama, host OS, iOS application, BIOS, GPU configuration, tunnels, ports, or shared services for an EBC feature.
- Do not launch a second shared agent, rotate shared tokens, rename shared bindings, or point EBC at another tenant's Worker, database, queue, bucket, voice, or avatar.
- Do not run a plain `wrangler deploy`; use the EBC deployment runbook and named scripts.
- If multiple tenants open LiveKit rooms but no avatar joins, treat it as a shared-runtime incident. Keep EBC unchanged and recover through the EILA runtime owner repository.

### Required EBC deployment flow

1. Read this file and `docs/cloudflare/EBC-TENANT-DEPLOYMENT.md`.
2. Confirm every resource target is EBC-owned.
3. Update only the EBC tenant adapter/configuration.
4. Run EBC tests, build, isolation checks, and readiness/session smoke tests.
5. Deploy only the documented EBC targets in order.
6. Stop and request explicit authorization before any cross-repository, host-machine, shared-runtime, or central-platform change.
