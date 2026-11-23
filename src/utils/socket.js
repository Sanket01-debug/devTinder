const { Server } = require("socket.io");
const crypto = require("crypto");
const { Chat } = require("../models/chat");
const { areConnected } = require("./connections");
const { authenticateSocket } = require("./socketAuth");
const { createVideoCalls } = require("./videoCalls");
const origins = require("../config/origins");
const getSecretRoomId = (userId, targetUserId) => crypto.createHash("sha256")
  .update([userId, targetUserId].sort().join("$")).digest("hex");

function initializeSocket(server, dependencies = {}) {
  const allowedOrigins = origins();
  const connected = dependencies.areConnected || areConnected;
  const ChatModel = dependencies.Chat || Chat;
  const io = new Server(server, {
    cors: { origin: allowedOrigins, credentials: true },
    allowRequest: (req, callback) => callback(null, !req.headers.origin || allowedOrigins.includes(req.headers.origin)),
    maxHttpBufferSize: 100000,
  });
  io.use(dependencies.authenticateSocket || authenticateSocket);
  const videoCalls = createVideoCalls(io, { ...dependencies.callOptions, areConnected: connected });
  io.on("connection", (socket) => {
    const user = socket.data.user;
    const userId = String(user._id);
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.expiresAt - Date.now()));
    expiry.unref?.();
    socket.on("disconnect", () => clearTimeout(expiry));
    videoCalls.register(socket);
    socket.data.joinVersion = 0;
    const on = (event, action) => socket.on(event, async (data, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const joinVersion = event === "joinChat" ? ++socket.data.joinVersion : null;
      try {
        const { targetUserId } = data || {};
        if (Date.now() >= socket.data.expiresAt || !(await connected(userId, targetUserId))) {
          return reply({ ok: false, error: "An accepted connection is required." });
        }
        if (!socket.connected) return;
        if (joinVersion !== null && joinVersion !== socket.data.joinVersion) return reply({ ok: false, error: "Conversation changed." });
        await action(data, getSecretRoomId(userId, targetUserId));
        reply({ ok: true });
      } catch {
        reply({ ok: false, error: "Unable to update conversation." });
      }
    });
    on("joinChat", (data, roomId) => {
      if (socket.data.chatRoom) socket.leave(socket.data.chatRoom);
      socket.join(roomId);
      socket.data.chatRoom = roomId;
    });
    socket.on("leaveChat", () => {
      socket.data.joinVersion++;
      if (socket.data.chatRoom) socket.leave(socket.data.chatRoom);
      socket.data.chatRoom = null;
    });
    on("sendMessage", async ({ targetUserId, text }, roomId) => {
      if (typeof text !== "string" || !text.trim() || text.length > 10000) throw new Error("Invalid message");
      const messageText = text.trim();
      let chat = await ChatModel.findOne({ participants: { $all: [userId, targetUserId] } });
      if (!chat) chat = new ChatModel({ participants: [userId, targetUserId], messages: [] });
      chat.messages.push({ senderId: userId, text: messageText });
      await chat.save();
      io.to(roomId).emit("messageReceived", { senderId: userId, firstName: user.firstName,
        lastName: user.lastName, text: messageText });
    });
  });
  return { io, videoCalls };
}
module.exports = initializeSocket;
