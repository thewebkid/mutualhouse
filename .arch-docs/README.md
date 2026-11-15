# Mutual House — Architecture Docs

Internal reference for `mutualhouse.org`. Read the relevant doc before modifying code, and update affected docs whenever behavior changes.

---

## Files in this folder

| File | What it covers |
|---|---|
| [styles.md](./styles.md) | Warm Alignos-inspired palette, shared SCSS structure, serif floor, responsive breakpoints |
| [domain-models.md](./domain-models.md) | Isomorphic `shared/models/` (`becise` pattern) and `house-orchestration.js` command/event flow |
| [database.md](./database.md) | Neon Serverless Postgres (and local PGlite dev engine), schema, dual sequences, SHA-256 receipts |
| [auth-and-mcp.md](./auth-and-mcp.md) | Better Auth, path-scoped OAuth 2.1 MCP `2026-07-28`, Door 2 `mh_...` runner, Door 3 Ed25519 packets, Door 4 BYOK |
| [media-and-calls.md](./media-and-calls.md) | Private Cloudflare R2 presigned uploads, Safari/Chrome `MediaRecorder` voice notes, 2-peer WebRTC calls |

---

## Stack at a glance

```text
Frontend      Vue 3.5 + Vite 7 SPA + vite-plugin-pwa + handwritten SCSS (no Bootstrap/Tailwind)
Domain Graph  Isomorphic ES classes in shared/models/ wrapped in reactive(House.create(def))
API & MCP     Hono on Vercel Fluid Compute (Node.js 24 ESM) + @modelcontextprotocol/hono v2
Database      Neon Serverless Postgres (PGlite embedded Postgres 16 fallback when DATABASE_URL is unset locally)
Auth          Better Auth + Passkeys + Resend Magic Links + Path-Scoped MCP OAuth 2.1 + mh_ bearer keys
Media & Calls Private Cloudflare R2 + Browser MediaRecorder + Browser RTCPeerConnection (Cloudflare TURN)
```
