const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { io: client } = require("socket.io-client");
const initializeSocket = require("../src/utils/socket");
const User = require("../src/models/user");
const ConnectionRequest = require("../src/models/connectionRequest");
const { areConnected } = require("../src/utils/connections");
const { iceConfig } = require("../src/utils/iceConfig");
const A = "a".repeat(24), B = "b".repeat(24), C = "c".repeat(24);
process.env.JWT_SECRET = "only-for-isolated-tests-not-a-production-secret";
const once = (socket, event) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, done); reject(new Error(`Timed out waiting for ${event}`)); }, 2500);
  function done(data) { clearTimeout(timer); resolve(data); }
  socket.once(event, done);
});
const emit = (socket, event, data) => socket.timeout(2000).emitWithAck(event, data);
async function fixture(t, options = {}) {
  const oldFind = User.findById;
  User.findById = (id) => {
    const value = [A, B, C].includes(String(id)) ? { _id: id, firstName: id === A ? "Alice" : "Developer", lastName: "Test" } : null;
    const query = Promise.resolve(value); query.select = () => query; return query;
  };
  const saved = [];
  class Chat {
    constructor(data) { Object.assign(this, data); }
    static async findOne() { return saved[0]; }
    async save() { if (!saved.length) saved.push(this); }
  }
  const app = express(); app.use(cookieParser());
  app.use(require("../src/routes/video"));
  const server = http.createServer(app);
  const { io, videoCalls } = initializeSocket(server, {
    Chat, areConnected: options.areConnected || (async (a, b) => [a, b].sort().join() === [A, B].join()),
    callOptions: options.callOptions,
  });
  app.locals.videoCalls = videoCalls;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  const token = (id) => jwt.sign({ _id: id }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const connect = async (id, extra = {}) => {
    const socket = client(url, { transports: ["websocket"], forceNew: true, reconnection: false,
      extraHeaders: { Cookie: `token=${token(id)}`, Origin: "http://localhost:5173", ...extra }, autoConnect: false });
    sockets.push(socket);
    const connected = new Promise((resolve) => { socket.once("connect", () => resolve(socket)); socket.once("connect_error", (error) => resolve(error)); });
    socket.connect(); return connected;
  };
  t.after(async () => { sockets.forEach((s) => s.disconnect()); videoCalls.close(); await new Promise((resolve) => io.close(resolve)); User.findById = oldFind; });
  return { connect, saved, url, token, videoCalls };
}
async function ringing(f) {
  const a = await f.connect(A), b = await f.connect(B);
  const incoming = once(b, "incomingCall");
  const response = await emit(a, "initiateCall", { targetUserId: B, userId: C });
  assert.equal(response.ok, true);
  assert.equal((await incoming).caller._id, A);
  return { a, b, callId: response.callId };
}
test("JWT cookie authentication rejects missing, invalid, expired and unknown users", async (t) => {
  const f = await fixture(t);
  for (const cookie of ["", "token=invalid", `token=${jwt.sign({ _id: A }, process.env.JWT_SECRET, { expiresIn: -1 })}`, `token=${f.token("d".repeat(24))}`]) {
    assert.ok(await f.connect(A, { Cookie: cookie }) instanceof Error);
  }
  assert.ok((await f.connect(A)).connected);
});
test("cross-origin WebSocket handshakes are rejected", async (t) => {
  const f = await fixture(t); assert.ok(await f.connect(A, { Origin: "https://attacker.example" }) instanceof Error);
});
test("accepted connections can ring, accept and exchange authorized SDP/ICE", async (t) => {
  const f = await fixture(t); const { a, b, callId } = await ringing(f);
  const accepted = once(a, "callAccepted");
  assert.equal((await emit(b, "acceptCall", { callId })).ok, true); await accepted;
  for (const [from, to, event, payload] of [
    [a, b, "webrtcOffer", { description: { type: "offer", sdp: "test-offer" } }],
    [b, a, "webrtcAnswer", { description: { type: "answer", sdp: "test-answer" } }],
    [a, b, "iceCandidate", { candidate: { candidate: "candidate:test", sdpMid: "0", sdpMLineIndex: 0 } }],
  ]) {
    const received = once(to, event);
    assert.equal((await emit(from, event, { callId, ...payload })).ok, true);
    assert.equal((await received).callId, callId);
  }
  assert.equal((await emit(a, "callConnected", { callId })).ok, true);
  assert.equal((await emit(b, "callConnected", { callId })).ok, true);
  const ended = once(a, "callEnded");
  assert.equal((await emit(b, "endCall", { callId })).ok, true); assert.equal((await ended).reason, "ended");
  assert.equal(f.videoCalls.hasCall(A), false);
});
test("unconnected, self and invalid targets cannot be called", async (t) => {
  const f = await fixture(t); const a = await f.connect(A);
  for (const [targetUserId, error] of [[C, "forbidden"], [A, "invalid"], ["bad", "invalid"]]) {
    assert.equal((await emit(a, "initiateCall", { targetUserId })).error, error);
  }
});
test("offline receiver is unavailable", async (t) => {
  const f = await fixture(t); const a = await f.connect(A);
  assert.equal((await emit(a, "initiateCall", { targetUserId: B })).error, "unavailable");
});
test("decline releases both participants", async (t) => {
  const f = await fixture(t); const { a, b, callId } = await ringing(f);
  const ended = once(a, "callEnded"); assert.equal((await emit(b, "rejectCall", { callId })).ok, true);
  assert.equal((await ended).reason, "declined"); assert.equal(f.videoCalls.hasCall(B), false);
});
test("busy users and duplicate requests cannot create another call", async (t) => {
  const f = await fixture(t, { areConnected: async () => true });
  const { a } = await ringing(f); const c = await f.connect(C);
  assert.equal((await emit(c, "initiateCall", { targetUserId: B })).error, "busy");
  assert.equal((await emit(a, "initiateCall", { targetUserId: B })).ok, false);
});
test("simultaneous requests reserve the users exactly once after async authorization", async (t) => {
  const f = await fixture(t, { areConnected: async () => { await new Promise((r) => setTimeout(r, 10)); return true; } });
  const a = await f.connect(A), b = await f.connect(B);
  const results = await Promise.all([emit(a, "initiateCall", { targetUserId: B }), emit(b, "initiateCall", { targetUserId: A })]);
  assert.equal(results.filter((r) => r.ok).length, 1); assert.equal(results.find((r) => !r.ok).error, "busy");
});
test("ring timeout and connection timeout release calls", async (t) => {
  const f = await fixture(t, { callOptions: { ringMs: 100, connectMs: 100 } });
  const { a, b } = await ringing(f);
  assert.equal((await once(a, "callEnded")).reason, "timeout");
  const call = await emit(b, "initiateCall", { targetUserId: A });
  const ended = once(b, "callEnded");
  await emit(a, "acceptCall", { callId: call.callId });
  assert.equal((await ended).reason, "connectionTimeout");
});
for (const receiver of [false, true]) test(`${receiver ? "receiver" : "caller"} disconnect ends the call`, async (t) => {
  const f = await fixture(t); const { a, b, callId } = await ringing(f);
  await emit(b, "acceptCall", { callId });
  const ended = once(receiver ? a : b, "callEnded"); (receiver ? b : a).disconnect();
  assert.equal((await ended).reason, "disconnected"); assert.equal(f.videoCalls.hasCall(A), false);
});
test("only the answering tab can signal; other tabs are dismissed", async (t) => {
  const f = await fixture(t); const { a, b, callId } = await ringing(f); const second = await f.connect(B);
  const dismissed = once(second, "callDismissed");
  const answers = await Promise.all([emit(b, "acceptCall", { callId }), emit(second, "acceptCall", { callId })]);
  assert.equal(answers.filter((r) => r.ok).length, 1); await dismissed;
  assert.equal((await emit(second, "endCall", { callId })).error, "forbidden");
  assert.equal((await emit(a, "acceptCall", { callId })).ok, false);
});
test("nonparticipants, wrong roles, duplicate offers and malformed ICE are blocked", async (t) => {
  const f = await fixture(t); const { a, b, callId } = await ringing(f); const c = await f.connect(C);
  for (const event of ["acceptCall", "rejectCall", "endCall", "webrtcOffer", "webrtcAnswer", "iceCandidate", "callConnected"]) {
    assert.equal((await emit(c, event, { callId })).error, "forbidden");
  }
  assert.equal((await emit(a, "webrtcOffer", { callId })).error, "stale");
  await emit(b, "acceptCall", { callId });
  assert.equal((await emit(b, "webrtcOffer", { callId })).error, "forbidden");
  assert.equal((await emit(a, "iceCandidate", { callId, candidate: { candidate: "x", sdpMLineIndex: -1 } })).error, "invalid");
  const offer = { callId, description: { type: "offer", sdp: "test" } };
  assert.equal((await emit(a, "webrtcOffer", offer)).ok, true);
  assert.equal((await emit(a, "webrtcOffer", offer)).error, "forbidden");
});
test("chat still joins, persists and broadcasts with authenticated names and IDs", async (t) => {
  const f = await fixture(t); const a = await f.connect(A), b = await f.connect(B), c = await f.connect(C);
  for (const [socket, target] of [[a, B], [b, A]]) assert.equal((await emit(socket, "joinChat", { targetUserId: target })).ok, true);
  const received = once(b, "messageReceived");
  assert.equal((await emit(a, "sendMessage", { targetUserId: B, userId: C, firstName: "Imposter", text: " hello " })).ok, true);
  assert.deepEqual(await received, { senderId: A, firstName: "Alice", lastName: "Test", text: "hello" });
  assert.equal(f.saved[0].messages[0].senderId, A);
  assert.equal((await emit(c, "joinChat", { targetUserId: B, userId: A })).ok, false);
  assert.equal((await emit(c, "sendMessage", { targetUserId: B, text: "intrusion" })).ok, false);
  assert.equal(f.saved[0].messages.length, 1);
});
test("ICE config needs authentication and an active call; responses are not cacheable", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.url}/video/ice`)).status, 401);
  const headers = { Cookie: `token=${f.token(A)}` };
  assert.equal((await fetch(`${f.url}/video/ice`, { headers })).status, 403);
  await ringing(f);
  const response = await fetch(`${f.url}/video/ice`, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(Array.isArray((await response.json()).iceServers));
});
test("TURN configuration returns expiring credentials without the shared secret", () => {
  const config = iceConfig(A, { STUN_URLS: "stun:example.org", TURN_URLS: "turn:example.org:3478,turns:example.org:443", TURN_SHARED_SECRET: "test-secret", ICE_TRANSPORT_POLICY: "relay" }, 1000000);
  assert.equal(config.iceTransportPolicy, "relay"); assert.equal(config.iceServers[1].username, `87400:${A}`);
  assert.equal(JSON.stringify(config).includes("test-secret"), false);
  assert.throws(() => iceConfig(A, { TURN_URLS: "turn:example.org" }));
});
test("connection query requires accepted status in either direction", async (t) => {
  const old = ConnectionRequest.exists; let query;
  ConnectionRequest.exists = async (q) => { query = q; return true; };
  t.after(() => { ConnectionRequest.exists = old; });
  assert.equal(await areConnected(A, B), true); assert.equal(query.status, "accepted");
  assert.deepEqual(query.$or, [{ fromUserId: A, toUserId: B }, { fromUserId: B, toUserId: A }]);
  assert.equal(await areConnected(A, A), false); assert.equal(await areConnected(A, "invalid"), false);
});
test("JWT signing uses the same configured secret as verification", async () => {
  const token = await new User({ _id: A }).getJWT();
  assert.equal(jwt.verify(token, process.env.JWT_SECRET)._id, A);
});
test("a delayed chat join cannot rejoin after navigating away", async (t) => {
  let authorize;
  const f = await fixture(t, { areConnected: () => new Promise((resolve) => { authorize = resolve; }) });
  const a = await f.connect(A);
  const joined = emit(a, "joinChat", { targetUserId: B });
  while (!authorize) await new Promise((resolve) => setImmediate(resolve));
  a.emit("leaveChat");
  await new Promise((resolve) => setTimeout(resolve, 20));
  authorize(true);
  assert.equal((await joined).ok, false);
});
test("cancellation while acceptance awaits authorization cannot resurrect a call", async (t) => {
  let authorize; let checks = 0;
  const f = await fixture(t, { areConnected: async () => ++checks === 1 || await new Promise((resolve) => { authorize = resolve; }) });
  const { a, b, callId } = await ringing(f);
  const accepted = emit(b, "acceptCall", { callId });
  while (!authorize) await new Promise((resolve) => setImmediate(resolve));
  await emit(a, "endCall", { callId }); authorize(true);
  assert.equal((await accepted).error, "stale"); assert.equal(f.videoCalls.hasCall(A), false);
});
test("free accounts can start and answer more than five accepted calls without a quota", async (t) => {
  const f = await fixture(t); const b = await f.connect(B);
  for (let i = 0; i < 6; i++) {
    const a = await f.connect(A);
    const call = await emit(a, "initiateCall", { targetUserId: B });
    assert.equal(call.ok, true);
    assert.equal((await emit(b, "acceptCall", { callId: call.callId })).ok, true);
    assert.equal((await emit(a, "endCall", { callId: call.callId })).ok, true);
    a.disconnect();
  }
});
