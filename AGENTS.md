# EBC repository boundary

This repository is an isolated Everything Built Custom product module. EBC changes must remain inside `blackholecapital/EBC` and EBC-named deployment resources.

## Hard rules for agents

- Never edit, commit to, open a pull request against, or require a code change in `blackholecapital/cloudflare-platform` for EBC work. That repository is deployment infrastructure and is outside EBC's authorization boundary.
- Never modify AI Fans, Buddy's, EILA/LS Overwatch, ACE, or another product repository to implement an EBC feature. Those repositories may be inspected read-only as architectural references.
- Do not add service bindings to another product's Workers. EBC Workers, queues, databases, buckets, datasets, agents, and service bindings must use EBC-owned names.
- Account-level Cloudflare Secrets Store entries may be consumed by name from EBC Wrangler files. Consuming an existing deployment secret does not authorize changing the deployment platform or another repository.
- If an EBC feature appears to require a cross-repository code change, stop and ask the owner. The default implementation is an EBC-owned adapter inside this repository.

For the deploy topology and verification commands, read `docs/cloudflare/EBC-TENANT-DEPLOYMENT.md`.
