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
