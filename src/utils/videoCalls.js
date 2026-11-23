const { randomUUID } = require("crypto");
const { validId } = require("./connections");

// One registry per Socket.IO server. Production must use one Node/PM2 instance.
function createVideoCalls(io, { areConnected, ringMs = 30000, connectMs = 45000,
  maxCallMs = 4 * 60 * 60 * 1000 } = {}) {
  const calls = new Map();
  const busy = new Map();
  const online = new Map();
  const userRoom = (id) => `video-user:${id}`;
  const summary = (user) => ({ _id: String(user._id), firstName: user.firstName,
    lastName: user.lastName, photoUrl: user.photoUrl });
  const finish = (call, reason) => {
    if (!calls.delete(call.id)) return;
    clearTimeout(call.timer);
    busy.delete(call.caller); busy.delete(call.receiver);
    io.to(call.callerSocket).to(userRoom(call.receiver)).emit("callEnded", { callId: call.id, reason });
  };
  const deadline = (call, ms, reason) => {
    clearTimeout(call.timer);
    call.timer = setTimeout(() => finish(call, reason), ms);
    call.timer.unref?.();
  };
  function register(socket) {
    const user = socket.data.user;
    const id = String(user._id);
    if (!online.has(id)) online.set(id, new Set());
    online.get(id).add(socket.id);
    socket.join(userRoom(id));
    let lastInitiate = 0;
    const guard = (name, fn) => socket.on(name, async (data, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        if (!socket.connected || Date.now() >= socket.data.expiresAt) throw new Error("unauthenticated");
        const result = await fn(data || {});
        reply({ ok: true, ...result });
      } catch (error) {
        const codes = ["unauthenticated", "invalid", "forbidden", "busy", "unavailable", "stale", "rateLimited"];
        reply({ ok: false, error: codes.includes(error.message) ? error.message : "serverError" });
      }
    });
    const ownedCall = (callId, ringingAllowed = false) => {
      const call = calls.get(callId);
      if (!call) throw new Error("stale");
      const owner = call.callerSocket === socket.id ||
        (call.receiver === id && (call.receiverSocket === socket.id || (ringingAllowed && call.state === "ringing")));
      if (!owner) throw new Error("forbidden");
      return call;
    };
    guard("initiateCall", async ({ targetUserId }) => {
      if (!validId(targetUserId) || targetUserId === id) throw new Error("invalid");
      if (Date.now() - lastInitiate < 1000) throw new Error("rateLimited");
      lastInitiate = Date.now();
      if (!(await areConnected(id, targetUserId))) throw new Error("forbidden");
      // Re-check after the DB await; simultaneous requests cannot reserve either user twice.
      if (!socket.connected || Date.now() >= socket.data.expiresAt) throw new Error("unavailable");
      if (busy.has(id) || busy.has(targetUserId)) throw new Error("busy");
      if (!online.get(targetUserId)?.size) throw new Error("unavailable");
      const call = { id: randomUUID(), caller: id, receiver: targetUserId,
        callerSocket: socket.id, state: "ringing", candidates: new Map(), connected: new Set() };
      calls.set(call.id, call); busy.set(id, call.id); busy.set(targetUserId, call.id);
      deadline(call, ringMs, "timeout");
      socket.emit("callRinging", { callId: call.id });
      io.to(userRoom(targetUserId)).emit("incomingCall", { callId: call.id, caller: summary(user) });
      return { callId: call.id };
    });
    guard("acceptCall", async ({ callId }) => {
      const call = ownedCall(callId, true);
      if (id !== call.receiver || call.state !== "ringing") throw new Error("stale");
      if (!(await areConnected(call.caller, call.receiver))) { finish(call, "forbidden"); throw new Error("forbidden"); }
      if (!socket.connected || !calls.has(callId) || call.state !== "ringing") throw new Error("stale");
      call.receiverSocket = socket.id; call.state = "accepted";
      deadline(call, connectMs, "connectionTimeout");
      socket.to(userRoom(id)).emit("callDismissed", { callId });
      io.to(call.callerSocket).to(socket.id).emit("callAccepted", { callId });
    });
    guard("rejectCall", ({ callId }) => {
      const call = ownedCall(callId, true);
      if (id !== call.receiver || call.state !== "ringing") throw new Error("stale");
      finish(call, "declined");
    });
    guard("endCall", ({ callId }) => finish(ownedCall(callId, true), "ended"));
    for (const [event, type] of [["webrtcOffer", "offer"], ["webrtcAnswer", "answer"], ["iceCandidate", "candidate"]]) {
      guard(event, ({ callId, description, candidate }) => {
        const call = ownedCall(callId);
        if (call.state !== "accepted") throw new Error("stale");
        const isCaller = socket.id === call.callerSocket;
        let payload;
        if (type === "candidate") {
          if (!candidate || typeof candidate.candidate !== "string" || candidate.candidate.length > 4096 ||
            (candidate.sdpMid != null && (typeof candidate.sdpMid !== "string" || candidate.sdpMid.length > 256)) ||
            (candidate.sdpMLineIndex != null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0))) throw new Error("invalid");
          const count = (call.candidates.get(socket.id) || 0) + 1;
          if (count > 256) throw new Error("rateLimited");
          call.candidates.set(socket.id, count);
          payload = { candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } };
        } else {
          if ((type === "offer") !== isCaller || call[type] || (type === "answer" && !call.offer)) throw new Error("forbidden");
          if (description?.type !== type || typeof description.sdp !== "string" || description.sdp.length > 65536) throw new Error("invalid");
          call[type] = true;
          payload = { description: { type, sdp: description.sdp } };
        }
        io.to(isCaller ? call.receiverSocket : call.callerSocket).emit(event, { callId, ...payload });
      });
    }
    guard("callConnected", ({ callId }) => {
      const call = ownedCall(callId);
      if (!call.answer) throw new Error("stale");
      call.connected.add(socket.id);
      if (call.connected.size === 2 && !call.established) {
        call.established = true;
        deadline(call, maxCallMs, "durationLimit");
      }
    });
    socket.on("disconnect", () => {
      online.get(id)?.delete(socket.id);
      if (!online.get(id)?.size) online.delete(id);
      const call = calls.get(busy.get(id));
      if (call && (call.callerSocket === socket.id || call.receiverSocket === socket.id ||
        (call.receiver === id && !online.has(id)))) finish(call, "disconnected");
    });
  }
  return { register, hasCall: (id) => busy.has(String(id)), close: () => {
    for (const call of calls.values()) finish(call, "serverRestart");
  } };
}
module.exports = { createVideoCalls };
