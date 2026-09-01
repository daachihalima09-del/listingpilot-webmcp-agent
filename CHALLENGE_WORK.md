# Challenge provenance

- The commercial ListingPilot product existed before the WebMCP Challenge.
- This repository’s WebMCP Challenge Edition, WebMCP registration, synthetic adapter, demo data, focused UI, tests, and documentation are challenge work.
- The repository does not contain the commercial Product Truth engine, AI Detective implementation, Catalog Health scoring internals, generation engine/prompts, production merchant systems, or Shopify publishing implementation.
- Every Product and evidence item in this edition is synthetic and original to the demo.
- No claim is made that the commercial ListingPilot product was created during the challenge.

## Day 2 — human-approved synthetic publishing

- Added exactly one WebMCP tool: `publish_approved_changes`.
- Preserved the human-only approval transition; no WebMCP tool can approve a proposal.
- Added integrity-checked, idempotent publishing of the stored approved title and description to the synthetic catalog only.
- Added explicit attempted, blocked, succeeded, and duplicate-ignored audit events.
- Replaced process-global state with a signed, bounded, serverless-safe browser session adapter suitable for the public Vercel demo.
- Added visible approved/waiting and published states plus a challenge reset control.
- No OpenAI, Shopify, merchant credentials, private source, or commercial ListingPilot code was introduced.

## Day 2.1 — live embedded-browser hardening

- Made all WebMCP and visible UI API requests explicitly credentialed and uncached.
- Updated the production challenge cookie for secure partitioned embedded-browser use while retaining strict signature, schema, size, and expiry controls.
- Made the four-tool registration stable for the document lifetime and added post-registration discovery verification with one bounded missing-tool retry.
- Added safe registration/session diagnostics and the stable `HUMAN_APPROVAL_REQUIRED` blocked-publish error code.
- Preserved the separate visible human approval transition and the exact-content, synthetic-only publisher.

## Day 2.4 — durable approval and standards-based tool lifecycle

- Replaced the embedded-browser cookie snapshot with bounded Upstash-backed challenge sessions. The browser holds only a signed opaque pointer; production state is server-authoritative and expires after 24 hours.
- Added atomic revision compare-and-set writes so stale concurrent requests cannot regress `APPROVED` or `PUBLISHED` state.
- Added independent reload/request coverage for awaiting, approved, published, idempotent, exact-content, and isolation behavior.
- Replaced focus/visibility/interval registration repairs with one registration per document `ModelContext`, `getTools()` verification, and `toolchange` reconciliation.
- Documented the platform boundary: the page can expose tools for its document, but cannot force ChatGPT to keep that page attached as the current site-tools source across a separate confirmation turn.
- Kept exactly four WebMCP tools, with no agent-callable approval transition, and introduced no OpenAI or Shopify integration.

## Day 2.4.1 — production Redis diagnostics

- Isolated the Upstash command adapter and added production-shaped contract coverage for `GET`, `SET NX EX`, atomic Lua CAS, and `DEL`.
- Classified configuration, authentication, permission, connectivity, command-support, general provider, stale-revision, and malformed-state failures with safe correlation references.
- Ensured provider error messages, Redis keys, session bearers, stored payloads, and credentials never appear in client responses or bounded diagnostic logs.
- Documented that production requires the normal write-enabled Upstash REST token in the exact Vercel environment being deployed.
- Retained atomic Lua CAS because Upstash supports scripting and a multi-request replacement would allow stale state regression.
