/**
 * Lightweight in-process wake bus so Door 2 agent runners (`Doc`) and open
 * browser long-polls wake within milliseconds of a `.` tempo pulse, `@invocation`,
 * turn post, or seal release—without burning DB polls while idle.
 */

const _roomWaiters = new Map(); // roomId -> Set<() => void>
const _houseWaiters = new Map(); // houseId -> Set<() => void>

export function emitRoomWake(roomId, houseId = null) {
  if (roomId && _roomWaiters.has(roomId)) {
    for (const resolve of [..._roomWaiters.get(roomId)]) {
      resolve();
    }
  }
  if (houseId && _houseWaiters.has(houseId)) {
    for (const resolve of [..._houseWaiters.get(houseId)]) {
      resolve();
    }
  }
}

export function waitForWakeOrTimeout({ roomId = null, houseId = null, ms = 750, signal = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (roomId) _roomWaiters.get(roomId)?.delete(finish);
      if (houseId) _houseWaiters.get(houseId)?.delete(finish);
      if (signal) signal.removeEventListener('abort', finish);
      resolve();
    };

    const timer = setTimeout(finish, ms);
    if (roomId) {
      if (!_roomWaiters.has(roomId)) _roomWaiters.set(roomId, new Set());
      _roomWaiters.get(roomId).add(finish);
    }
    if (houseId) {
      if (!_houseWaiters.has(houseId)) _houseWaiters.set(houseId, new Set());
      _houseWaiters.get(houseId).add(finish);
    }
    if (signal) {
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener('abort', finish, { once: true });
    }
  });
}
