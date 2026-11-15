import { api } from './api.js';
import { globalState, getActiveRoom, showError } from './state.js';

let _pc = null;
let _makingOffer = false;
let _ignoreOffer = false;
let _signalCursor = 0;
let _pollTimer = null;
let _heartbeatTimer = null;
let _cameraVideoTrack = null;

/**
 * Wait until `iceGatheringState === 'complete'` (or `timeoutMs` cap) so we send
 * ONE gathered SDP over stateless Fluid Compute HTTP rather than 50 trickle POSTs.
 */
function waitForIceGathering(pc, timeoutMs = 2500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    }, timeoutMs);
    function check() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export async function joinActiveRoomCall({ video = true, audio = true } = {}) {
  const room = getActiveRoom();
  if (!room) return;
  if (globalState.call.status !== 'idle') {
    await leaveActiveRoomCall();
  }

  globalState.call.error = null;
  globalState.call.status = 'joining';
  globalState.call.roomId = room.id;
  globalState.call.audioEnabled = audio;
  globalState.call.videoEnabled = video;

  try {
    // Acquire user media first inside the tap gesture
    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: audio ? { echoCancellation: true, noiseSuppression: true } : false,
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    globalState.call.localStream = localStream;
    _cameraVideoTrack = localStream.getVideoTracks()[0] ?? null;

    const joinRes = await api.joinRoomCall(room.id, {
      audioEnabled: audio,
      videoEnabled: video,
    });

    globalState.call.sessionId = joinRes.session.id;
    globalState.call.polite = Boolean(joinRes.polite);
    globalState.call.peerInhabitantId = joinRes.peerInhabitantId ?? null;
    globalState.call.status = joinRes.peerInhabitantId ? 'ringing' : 'ringing';
    _signalCursor = joinRes.lastSignalSeq ?? 0;

    const remoteStream = new MediaStream();
    globalState.call.remoteStream = remoteStream;

    _pc = new RTCPeerConnection({
      iceServers: joinRes.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }],
      iceTransportPolicy: 'all',
    });

    for (const track of localStream.getTracks()) {
      _pc.addTrack(track, localStream);
    }

    _pc.ontrack = ({ track, streams }) => {
      if (streams?.[0]) {
        globalState.call.remoteStream = streams[0];
      } else {
        remoteStream.addTrack(track);
      }
      globalState.call.status = 'connected';
    };

    _pc.oniceconnectionstatechange = () => {
      if (!_pc) return;
      if (_pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        globalState.call.status = 'connected';
      } else if (_pc.iceConnectionState === 'failed') {
        globalState.call.status = 'failed';
        globalState.call.error = 'Peer connection failed across NAT/firewall.';
      }
    };

    // Perfect Negotiation: impolite or newly-arriving second peer initiates offer
    _pc.onnegotiationneeded = async () => {
      if (!_pc || !globalState.call.peerInhabitantId) return;
      try {
        _makingOffer = true;
        await _pc.setLocalDescription();
        await waitForIceGathering(_pc, 2500);
        await api.sendCallSignal(room.id, {
          sessionId: globalState.call.sessionId,
          description: _pc.localDescription,
        });
      } catch (err) {
        console.warn('[webrtc] negotiation error:', err);
      } finally {
        _makingOffer = false;
      }
    };

    if (joinRes.peerInhabitantId && !globalState.call.polite) {
      // Impolite peer triggers initial gathered offer
      _makingOffer = true;
      await _pc.setLocalDescription();
      await waitForIceGathering(_pc, 2500);
      await api.sendCallSignal(room.id, {
        sessionId: globalState.call.sessionId,
        description: _pc.localDescription,
      });
      _makingOffer = false;
    }

    // 5-second heartbeat (server enforces 20s staleness TTL)
    _heartbeatTimer = setInterval(() => {
      if (!globalState.call.roomId) return;
      api
        .heartbeatCall(globalState.call.roomId, {
          audioEnabled: globalState.call.audioEnabled,
          videoEnabled: globalState.call.videoEnabled,
          screenSharing: globalState.call.screenSharing,
        })
        .catch(() => {});
    }, 5000);

    // Poll SDP signals every 900ms while in call
    _pollTimer = setInterval(() => {
      pollSignalsOnce().catch(() => {});
    }, 900);
    await pollSignalsOnce();
  } catch (err) {
    await leaveActiveRoomCall();
    globalState.call.error = err?.message || 'Could not start call.';
    showError(globalState.call.error);
  }
}

async function pollSignalsOnce() {
  const roomId = globalState.call.roomId;
  if (!roomId || !_pc) return;
  const state = await api.pollCallState(roomId, _signalCursor);

  if (!state.session || state.session.status === 'ended') {
    await leaveActiveRoomCall();
    return;
  }

  const prevPeer = globalState.call.peerInhabitantId;
  globalState.call.polite = Boolean(state.polite);
  globalState.call.peerInhabitantId = state.peerInhabitantId ?? null;

  // If second peer just joined and we are the impolite side with no remote description yet, send offer
  if (!prevPeer && state.peerInhabitantId && !globalState.call.polite && !_pc.remoteDescription) {
    _makingOffer = true;
    await _pc.setLocalDescription();
    await waitForIceGathering(_pc, 2500);
    await api.sendCallSignal(roomId, {
      sessionId: globalState.call.sessionId,
      description: _pc.localDescription,
    });
    _makingOffer = false;
  }

  for (const sig of state.signals || []) {
    if (sig.seq > _signalCursor) _signalCursor = sig.seq;
    if (!sig.description) continue;

    const description = sig.description;
    const offerCollision =
      description.type === 'offer' && (_makingOffer || _pc.signalingState !== 'stable');

    _ignoreOffer = !globalState.call.polite && offerCollision;
    if (_ignoreOffer) continue;

    await _pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await _pc.setLocalDescription();
      await waitForIceGathering(_pc, 2500);
      await api.sendCallSignal(roomId, {
        sessionId: globalState.call.sessionId,
        description: _pc.localDescription,
      });
    }
  }
}

export function toggleCallAudio() {
  const stream = globalState.call.localStream;
  if (!stream) return;
  const next = !globalState.call.audioEnabled;
  for (const track of stream.getAudioTracks()) track.enabled = next;
  globalState.call.audioEnabled = next;
}

export function toggleCallVideo() {
  const stream = globalState.call.localStream;
  if (!stream) return;
  const next = !globalState.call.videoEnabled;
  for (const track of stream.getVideoTracks()) track.enabled = next;
  globalState.call.videoEnabled = next;
}

export async function toggleScreenShare() {
  if (!_pc || !globalState.call.localStream) return;
  const sender = _pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender) return;

  if (!globalState.call.screenSharing) {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = displayStream.getVideoTracks()[0];
    if (!screenTrack) return;
    await sender.replaceTrack(screenTrack);
    globalState.call.screenSharing = true;
    screenTrack.onended = () => {
      if (_cameraVideoTrack) sender.replaceTrack(_cameraVideoTrack).catch(() => {});
      globalState.call.screenSharing = false;
    };
  } else if (_cameraVideoTrack) {
    await sender.replaceTrack(_cameraVideoTrack);
    globalState.call.screenSharing = false;
  }
}

export async function leaveActiveRoomCall() {
  const roomId = globalState.call.roomId;
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
  if (_pc) {
    try {
      _pc.close();
    } catch {
      // ignore
    }
    _pc = null;
  }
  if (globalState.call.localStream) {
    for (const t of globalState.call.localStream.getTracks()) {
      try {
        t.stop();
      } catch {
        // ignore
      }
    }
  }
  _cameraVideoTrack = null;
  globalState.call.status = 'idle';
  globalState.call.roomId = null;
  globalState.call.sessionId = null;
  globalState.call.localStream = null;
  globalState.call.remoteStream = null;
  globalState.call.peerInhabitantId = null;
  globalState.call.screenSharing = false;

  if (roomId) {
    await api.leaveRoomCall(roomId).catch(() => {});
  }
}

if (typeof document !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (globalState.call.roomId && navigator.sendBeacon) {
      navigator.sendBeacon(`/api/rooms/${encodeURIComponent(globalState.call.roomId)}/call/leave`);
    }
  });
}
