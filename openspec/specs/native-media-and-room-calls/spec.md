# native-media-and-room-calls Specification

## Purpose
Enables private-by-default multimedia sharing (inline Peripatetic browser voice recordings, PDFs, and images stored in private object storage) and zero-eavesdropping 2-occupant browser-native peer-to-peer audio/video calls inside any House room.
## Requirements
### Requirement: Private direct-to-storage media uploads with exact byte-size signing
The system SHALL upload voice recordings, images, and PDFs directly from the browser to private object storage using short-lived presigned `PUT` URLs cryptographically locked to the exact `Content-Length` and `Content-Type` of the file (capped at 25 MB for voice/media in Phase 1a), and SHALL serve media exclusively via short-lived signed `GET` URLs (never permanent public bucket URLs).

#### Scenario: Tampered byte length or MIME type on presigned PUT is rejected at storage edge
- **WHEN** a client requests a presigned `PUT` URL for a 1.2 MB `audio/mp4` recording and attempts to upload a different byte size or `Content-Type`
- **THEN** object storage rejects the upload with `403` before any bytes are committed to the room record

#### Scenario: Withdrawn or unauthorized media cannot be fetched via stale URL
- **WHEN** an outsider without room read access attempts to fetch an attachment after its short-lived signed `GET` URL expires (or after the object is deleted/withdrawn)
- **THEN** access is denied and no permanent public bucket URL exists

### Requirement: Cross-browser inline Peripatetic voice recording in room composer
The system SHALL allow human inhabitants to record inline voice notes directly inside the room composer using native browser media capture—selecting `audio/mp4` on Safari/WebKit (including iOS Home Screen PWAs) and `audio/webm;codecs=opus` on Chromium/Firefox, acquiring the microphone synchronously inside the user's tap gesture, stopping tracks cleanly when the app is backgrounded, and rendering playback via a native `<audio controls>` element while preserving schema linkage for sibling transcripts.

#### Scenario: Recording and posting a voice note on iOS Safari PWA and desktop Chrome
- **WHEN** a human taps the composer microphone button, speaks a reflection, and taps Send
- **THEN** the browser captures non-empty audio in a platform-valid container (`audio/mp4` on Safari/iOS, `audio/webm;codecs=opus` on Chrome/Firefox), uploads it via presigned `PUT`, and appends a room turn whose audio plays back cleanly across both desktop and mobile browsers

#### Scenario: Backgrounding mobile PWA releases microphone cleanly
- **WHEN** an inhabitant swipes away or backgrounds the app mid-recording (`visibilitychange` to `hidden`)
- **THEN** the app synchronously stops active microphone tracks so the OS recording indicator clears and prompts cleanly on return

### Requirement: Two-occupant browser-native peer-to-peer room audio/video calls
The system SHALL allow up to two authorized human occupants in any House room to conduct an encrypted peer-to-peer (`DTLS-SRTP`) audio/video (and optional screen-share) call using native browser `RTCPeerConnection` with server-assigned Perfect Negotiation roles (`polite`/`impolite`), single-POST gathered SDP exchange, ephemeral TURN relay credentials (`turns:443`), and a 20-second heartbeat TTL, while granting zero live audio/video access to AI inhabitants.

#### Scenario: Simultaneous call join resolves glare via Perfect Negotiation
- **WHEN** two human inhabitants in `#studio` click `Join Call` within the same second
- **THEN** the server attaches both to the same active room call session, assigns deterministic `polite` and `impolite` roles, exchanges gathered SDPs + TURN credentials, and establishes media without colliding into a stuck offer state

#### Scenario: Closing laptop lid clears ghost call presence within TTL
- **WHEN** a call participant closes their laptop lid or loses connectivity without clicking Leave
- **THEN** `visibilitychange` best-effort beacon and the 20-second heartbeat TTL mark the seat vacant so the room never remains permanently stuck in an active call state

#### Scenario: AI inhabitants never silently eavesdrop on room calls
- **WHEN** two humans are in an active room audio/video call
- **THEN** no AI inhabitant receives media tracks or background call transcripts unless a human explicitly records and posts a consented Contribution into the room afterward

