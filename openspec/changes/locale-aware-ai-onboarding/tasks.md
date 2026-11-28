## 1. Server Wake Fix, Locale Header & Bot Guide

- [x] 1.1 Decouple `dispatchMcpEventSubscriptions` from `addressing.webhookTargets.length` on `turn.post` and `room.pulse` in `server/services/room-commands.js`
- [x] 1.2 Expose `viewerCountry` (`x-vercel-ip-country` / `cf-ipcountry`) on `GET /api/auth/session` and serve public zero-PII `GET /welcome.md` (`text/markdown`) in `server/app.js`
- [x] 1.3 Default new AI inhabitants' `doorType` from host metadata (`defaultDoorTypeForHost`) in `server/services/house-service.js` when `doorType` is not explicitly forced

## 2. Shared Host Capabilities & Provider Disclosures

- [x] 2.1 Expand `HOST_KINDS` in `shared/lib/ai-hosts.js` with `gemini`, `perplexity`, `mistral`, `muse`, and `chinese_ai`, plus `resolveHostOnboardingContext`, `listOnboardingHostsForLocale`, `buildBotHelperPrompt`, and `buildWelcomeMarkdown`
- [x] 2.2 Add truthful `defaultProviderDisclosure` descriptions for `perplexity`, `mistral`, `muse`, and `deepseek` / Chinese companion providers in `shared/models/inhabitant.js`

## 3. Locale-Tailored Onboarding UI & Temporary Stakeholder Brief

- [x] 3.1 Store `viewerCountry` in `client/src/lib/state.js` and `loadSessionAndHouses()` in `client/src/lib/mut/house-orchestration.js`
- [x] 3.2 Upgrade `client/src/components/WelcomeAiModal.vue` with locale-ordered host choices, US/mobile gate awareness + override toggle, `/welcome.md` bot helper fold, in-modal Signed Arrival Packet mint & reply import, and Step 3 suppression for wake-less/packet hosts
- [x] 3.3 Sync `PROVIDERS` and host wake notes in `client/src/components/AiInhabitantCard.vue`
- [x] 3.4 Add temporary `noindex` stakeholder overview route `/brief/ai-landscape` (`client/src/pages/StakeholderBriefPage.vue` + `client/src/router/index.js`) adhering to `.arch-docs/styles.md`

## 4. Verification & Documentation

- [x] 4.1 Add automated tests in `tests/welcoming-ai.test.js` covering solo ChatGPT MCP Events on `@mention` + `.` pulse + `410` pruning, `GET /welcome.md`, `viewerCountry` extraction, and locale/device host capability resolution
- [x] 4.2 Update `.arch-docs/auth-and-mcp.md` and `openspec/specs/ai-host-onboarding-and-wakes/spec.md`, then verify `npm test` and `npm run build`
