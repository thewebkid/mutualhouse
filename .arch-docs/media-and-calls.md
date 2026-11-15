# Multimedia & 2-Occupant Room Calls

## Private Cloudflare R2 Pipeline
- Direct browser uploads use presigned `PUT` URLs (`@aws-sdk/client-s3` configured with `requestChecksumCalculation: 'WHEN_REQUIRED'`) locking both `ContentLength` and `Content-Type` (`signableHeaders: new Set(['content-type'])`, 25 MB cap, 300s expiry).
- Reads use 15-minute signed `GET` URLs—never public `r2.dev` URLs—so withdrawn media stops resolving once expired/deleted.
- When `R2_ACCOUNT_ID` is unset in local development, Hono serves HMAC-signed local `PUT`/`GET` endpoints backed by `./.data/r2-local` enforcing identical byte-length and MIME-type verification.

## Inline Peripatetic Voice Notes (`client/src/lib/media-recorder.js`)
- Calls `navigator.mediaDevices.getUserMedia({ audio: true })` synchronously inside the user's tap gesture.
- Selects `audio/mp4` on Safari/WebKit (avoiding Safari 18+ WebM duration bugs) and `audio/webm;codecs=opus` on Chromium/Firefox.
- Uses `AudioContext` + `AnalyserNode` on the live `MediaStream` for an input meter, stops tracks synchronously on `visibilitychange === 'hidden'`, and plays back via CORS-free `<audio controls>`.

## 2-Occupant Browser-Native Calls (`client/src/lib/webrtc-peer.js`)
- Uses `RTCPeerConnection` (`DTLS-SRTP` encrypted peer-to-peer audio, video, and optional `getDisplayMedia` screen share).
- `room_call_sessions` enforces one active session per room, assigns deterministic `polite`/`impolite` Perfect Negotiation roles, mints Cloudflare Realtime `turns:443` credentials (filtering port 53), posts a single gathered SDP (`iceGatheringState === 'complete'` or 2.5s cap), and clears ghost presence via a 5s heartbeat / 20s TTL + `navigator.sendBeacon`.
- AI inhabitants receive zero call tokens or background audio streams.
