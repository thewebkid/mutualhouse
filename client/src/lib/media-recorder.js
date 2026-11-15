import { globalState, showError } from './state.js';
import { uploadRoomFile, postRoomTurn } from './mut/house-orchestration.js';

let _stream = null;
let _recorder = null;
let _chunks = [];
let _startedAt = 0;
let _timerId = null;
let _audioCtx = null;
let _analyser = null;
let _rafId = null;

/**
 * Selects a reliable cross-browser recording MIME type:
 *  - Safari / iOS Home Screen PWA: MUST prefer `audio/mp4` (Safari 18+ claims
 *    `audio/webm;codecs=opus` support yet writes broken duration headers).
 *  - Chromium / Firefox: `audio/webm;codecs=opus` (or `audio/mp4` fallback).
 */
export function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);

  const candidates = isSafari
    ? ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported?.(mime)) return mime;
  }
  return '';
}

/**
 * Acquires the microphone SYNCHRONOUSLY inside the user's click/tap gesture
 * (before any `await fetch`) so iOS Safari Home Screen PWAs preserve user activation.
 */
export async function startVoiceRecording() {
  if (globalState.voice.recording) return;
  globalState.voice.error = null;

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    const msg = 'Inline voice recording is not available in this browser.';
    globalState.voice.error = msg;
    showError(msg);
    return;
  }

  try {
    // Must be first call inside the tap handler
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      _audioCtx = new AudioCtx();
      if (_audioCtx.state === 'suspended') {
        _audioCtx.resume().catch(() => {});
      }
    }

    _stream = await streamPromise;
    const mimeType = pickSupportedAudioMimeType();
    _chunks = [];
    _recorder = mimeType ? new MediaRecorder(_stream, { mimeType }) : new MediaRecorder(_stream);
    globalState.voice.mimeType = _recorder.mimeType || mimeType || 'audio/mp4';

    _recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) _chunks.push(ev.data);
    };

    if (_audioCtx) {
      const source = _audioCtx.createMediaStreamSource(_stream);
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 256;
      source.connect(_analyser);
      const data = new Uint8Array(_analyser.frequencyBinCount);
      const tick = () => {
        if (!_analyser || !globalState.voice.recording) return;
        _analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sumSq += norm * norm;
        }
        globalState.voice.level = Math.min(1, Math.sqrt(sumSq / data.length) * 3.2);
        _rafId = requestAnimationFrame(tick);
      };
      _rafId = requestAnimationFrame(tick);
    }

    _startedAt = Date.now();
    globalState.voice.durationMs = 0;
    globalState.voice.recording = true;
    _recorder.start(250);

    _timerId = setInterval(() => {
      globalState.voice.durationMs = Date.now() - _startedAt;
    }, 200);
  } catch (err) {
    teardownStreamSync();
    const msg = err?.message || 'Microphone permission was declined.';
    globalState.voice.error = msg;
    showError(msg);
  }
}

export function cancelVoiceRecording() {
  teardownStreamSync();
}

/**
 * Stops recording, uploads the recorded Blob directly to Private R2 via
 * exact-size presigned PUT, and posts a room Turn with the AudioAttachment.
 */
export async function finishAndSendVoiceRecording({
  caption = '',
  replyToId = null,
  invokedInhabitantIds = [],
  openSeal = null,
  sealId = null,
} = {}) {
  if (!_recorder || !globalState.voice.recording) return null;

  const durationMs = Math.max(500, Date.now() - _startedAt);
  const recorder = _recorder;
  const chosenMime = globalState.voice.mimeType || recorder.mimeType || 'audio/mp4';

  const blob = await new Promise((resolve) => {
    recorder.onstop = () => {
      const cleanMime = chosenMime.split(';')[0] || 'audio/mp4';
      resolve(new Blob(_chunks, { type: chosenMime || cleanMime }));
    };
    try {
      recorder.stop();
    } catch {
      resolve(new Blob(_chunks, { type: chosenMime }));
    }
  });

  teardownStreamSync();

  if (!blob || blob.size < 16) {
    showError('Voice clip was empty — please hold or speak for at least a second.');
    return null;
  }

  globalState.voice.uploading = true;
  try {
    const ext = chosenMime.includes('mp4') ? 'm4a' : 'webm';
    const file = new File([blob], `walk-note-${Date.now()}.${ext}`, {
      type: blob.type || chosenMime,
    });
    const attachment = await uploadRoomFile(file, { durationMs });
    return await postRoomTurn({
      body: caption,
      replyToId,
      contributionKind: 'turn',
      invokedInhabitantIds,
      attachmentIds: [attachment.id],
      openSeal,
      sealId,
    });
  } finally {
    globalState.voice.uploading = false;
  }
}

function teardownStreamSync() {
  if (_timerId) {
    clearInterval(_timerId);
    _timerId = null;
  }
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  if (_recorder && _recorder.state !== 'inactive') {
    try {
      _recorder.stop();
    } catch {
      // ignore
    }
  }
  _recorder = null;
  _chunks = [];

  if (_stream) {
    for (const track of _stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
    }
    _stream = null;
  }

  if (_audioCtx) {
    _audioCtx.close().catch(() => {});
    _audioCtx = null;
    _analyser = null;
  }

  globalState.voice.recording = false;
  globalState.voice.level = 0;
  globalState.voice.durationMs = 0;
}

// iOS Home Screen PWA: swiping away fires `visibilitychange -> hidden` synchronously
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && globalState.voice.recording) {
      teardownStreamSync();
    }
  });
}
