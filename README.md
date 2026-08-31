# ListingPilot Agent — WebMCP Challenge Edition

ListingPilot Agent is a small, independent WebMCP commerce copilot. A human and an agent can search a synthetic catalog, inspect explicitly classified Product Truth and Catalog Health, and prepare a safe listing improvement for visible human review.

This is the **WebMCP Challenge Edition**. The commercial ListingPilot application is separate, private, and is not included or required to run this repository.

## What WebMCP adds

WebMCP lets a page register structured browser tools for an agent. This app uses the current imperative API, `document.modelContext.registerTool(...)`, and exposes exactly three tools:

| Tool | Type | Input | Result | Side effect |
|---|---|---|---|---|
| `search_products` | READ | optional bounded `query` | Product summaries | bounded audit event |
| `inspect_product` | READ | `productId` | verified/conflicting/missing facts, evidence, health | bounded audit event |
| `prepare_listing_improvement` | PREPARE | `productId`, optional `focus` | awaiting-review proposal | stores draft proposal + audit event |

There is no approve tool and no publish tool. Product and evidence content is marked as untrusted data. Tool execution calls the same same-origin APIs used by the visible app.

## Human approval model

The agent can prepare an `AWAITING_APPROVAL` proposal, but cannot transition it to `APPROVED`. Approval is a separate server-validated transition reached only from the visible human review UI. Approval never publishes and there is no Shopify integration in this edition.

```mermaid
flowchart LR
  A[WebMCP agent] -->|search_products| B[Challenge APIs]
  A -->|inspect_product| B
  A -->|prepare_listing_improvement| B
  B --> C[Synthetic workspace adapter]
  C --> D[Awaiting-review proposal]
  D -->|visible UI + explicit confirmation| H[Human reviewer]
  H --> E[Approved proposal]
  E -. no Day 1 route .-> F[Publishing locked]
```

## Architecture and privacy boundary

- `src/data`: three original synthetic ecommerce Products.
- `src/domain`: challenge-only public contracts.
- `src/server`: deterministic workspace-scoped catalog, proposal state, validation, and bounded audit trail.
- `src/app/api`: same-origin server boundaries with strict Zod validation.
- `src/webmcp`: feature detection, tool contracts, registration, AbortController cleanup, and visible result events.
- `src/components`: focused human/agent collaboration UI.

The repository does **not** contain the commercial Product Truth engine, AI Detective internals, Catalog Health algorithms, generation prompts, merchant preferences, production Prisma schema, Shopify tokens/OAuth, Safe Publishing implementation, merchant data, or private source imports.

Day 1 state is intentionally in-memory. The service boundary can later receive a durable adapter without changing the WebMCP contracts. Restarting the server clears proposals and audit activity.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Day 1 uses no environment variables and makes no OpenAI or Shopify calls.

Quality gates:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Test WebMCP

### ChatGPT desktop in-app browser

1. Update the ChatGPT desktop app and ensure **Enable site tools** is on in Browser permissions.
2. Open the running app in ChatGPT’s built-in browser. A deployed HTTPS URL is preferred; `localhost` is a secure-context exception for local development.
3. Select the site-tools arrow in the address bar and confirm the three tools above appear.
4. Ask: “Search products that need improvement. Inspect the weakest result and prepare a full listing improvement.”
5. Confirm the proposal appears visibly and remains `AWAITING APPROVAL`.
6. Confirm ChatGPT cannot approve or publish. Use the visible **Approve proposal** button yourself if desired.

### Google Chrome experimental testing

1. Use a current Chrome build supporting WebMCP testing.
2. Enable `chrome://flags/#enable-webmcp-testing` and relaunch Chrome.
3. Open the local app, use DevTools/Lighthouse to inspect registered WebMCP tools, and confirm exactly three registrations.
4. Test tool execution with Chrome’s available experimental WebMCP tooling. Browser support is experimental and may vary by build/origin-trial access.

Manual discovery has not been claimed until these steps are run in a supported browser.

## Current references

Verified on 30 August 2026:

- [WebMCP Draft Community Group Report, 26 August 2026](https://webmachinelearning.github.io/webmcp/)
- [Chrome Imperative API documentation, updated 20 August 2026](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [OpenAI WebMCP Challenge requirements](https://openai.com/webmcp-challenge/)
- [Devpost submission requirements](https://webmcp.devpost.com/)
- [OpenAI site-tools help](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)

The API is experimental. The implementation feature-detects `document.modelContext`, uses strict JSON Schema, passes execution cancellation signals to `fetch`, and unregisters all tools through one `AbortController`.

## License

MIT applies only to this challenge repository. It does not license the commercial ListingPilot product, its private repository, algorithms, data, prompts, branding beyond this demo, or merchant systems. See [NOTICE.md](NOTICE.md) and [CHALLENGE_WORK.md](CHALLENGE_WORK.md).
