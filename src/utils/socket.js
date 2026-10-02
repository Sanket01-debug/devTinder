const socket = require("socket.io");
const crypto = require("crypto");
const { Chat } = require("../models/chat");

const getSecretRoomId = (userId, targetUserId) => {
  return crypto
    .createHash("sha256")
    .update([userId, targetUserId].sort().join("$"))
    .digest("hex");
};

const initializeSocket = (server) => {
  const io = socket(server, {
    cors: {
      origin: "http://localhost:5173",
    },
  });

  io.on("connection", (socket) => {
    socket.on("joinChat", ({ firstName, userId, targetUserId }) => {
      if (!userId || !targetUserId) return;

      const roomId = getSecretRoomId(userId, targetUserId);

      socket.join(roomId);
      console.log(firstName + " joined Room: " + roomId);
    });

    socket.on(
      "sendMessage",
      async ({ firstName, lastName, userId, targetUserId, text }) => {
        try {
          if (
            !userId ||
            !targetUserId ||
            typeof text !== "string" ||
            !text.trim()
          ) {
            return;
          }

          const messageText = text.trim();
          const roomId = getSecretRoomId(userId, targetUserId);

          // TODO: Verify the authenticated user and check friendship.

          let chat = await Chat.findOne({
            participants: { $all: [userId, targetUserId] },
          });

          if (!chat) {
            chat = new Chat({
              participants: [userId, targetUserId],
              messages: [],
            });
          }

          chat.messages.push({
            senderId: userId,
            text: messageText,
          });

          await chat.save();

          io.to(roomId).emit("messageReceived", {
            senderId: userId,
            firstName,
            lastName,
            text: messageText,
          });
        } catch (error) {
          console.error("Failed to save message:", error);
        }
      }
    );
  });
};

module.exports = initializeSocket;