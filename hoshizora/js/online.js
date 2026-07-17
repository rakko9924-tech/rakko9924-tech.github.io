// online.js — オンライン協力クライアント（決定論ロックステップ）
// サーバは人間の手だけを同順中継。AI席・離席者の手は全端末が同一の決定論AIで計算する。
const SERVER = 'hoshizora.rakko9924.workers.dev';

let ws = null;
let handlers = {};
let seat = -1;
let seats = [false, false, false, false];
let alive = false;

export function onlineActive() { return alive; }
export function mySeatOnline() { return seat; }
export function seatsOnline() { return seats.slice(); }

export function makeRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外
  let c = '';
  for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}

// h: { onJoined(seat, seats), onRoster(seats), onStart({missionId,seed,humanSeats}),
//      onAct(a), onSeatDrop(seat, seats), onLobby(seats), onClosed(reason), onFull() }
export function connectRoom(code, h) {
  disconnectRoom();
  handlers = h || {};
  const proto = location.protocol === 'https:' ? 'wss' : 'wss';
  ws = new WebSocket(`${proto}://${SERVER}/room/${code}`);
  ws.onopen = () => { alive = true; ws.send(JSON.stringify({ t: 'join' })); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'joined') { seat = m.seat; seats = m.seats; handlers.onJoined && handlers.onJoined(m.seat, m.seats); }
    else if (m.t === 'roster') { seats = m.seats; handlers.onRoster && handlers.onRoster(m.seats); }
    else if (m.t === 'start') { handlers.onStart && handlers.onStart(m); }
    else if (m.t === 'act') { handlers.onAct && handlers.onAct(m.a); }
    else if (m.t === 'seatDrop') { seats = m.seats; handlers.onSeatDrop && handlers.onSeatDrop(m.seat, m.seats); }
    else if (m.t === 'lobby') { seats = m.seats; handlers.onLobby && handlers.onLobby(m.seats); }
    else if (m.t === 'full') { handlers.onFull && handlers.onFull(m.reason); disconnectRoom(); }
  };
  ws.onclose = () => { const was = alive; alive = false; seat = -1; if (was && handlers.onClosed) handlers.onClosed('closed'); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

export function disconnectRoom() {
  if (ws) { handlers = {}; try { ws.onclose = null; ws.close(); } catch (e) {} }
  ws = null; alive = false; seat = -1; seats = [false, false, false, false];
}

export function sendStart(missionId, seed) {
  if (ws && alive) ws.send(JSON.stringify({ t: 'start', missionId, seed }));
}
export function sendAct(kind, mySeatIdx, card) {
  if (ws && alive) ws.send(JSON.stringify({ t: 'act', a: { kind, seat: mySeatIdx, card } }));
}
export function sendEnd() {
  if (ws && alive) ws.send(JSON.stringify({ t: 'end' }));
}
