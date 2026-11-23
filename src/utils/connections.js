const ConnectionRequest = require("../models/connectionRequest");

const validId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
async function areConnected(userId, targetUserId) {
  userId = String(userId);
  if (!validId(targetUserId) || userId === targetUserId) return false;
  return Boolean(await ConnectionRequest.exists({
    status: "accepted",
    $or: [
      { fromUserId: userId, toUserId: targetUserId },
      { fromUserId: targetUserId, toUserId: userId },
    ],
  }));
}
module.exports = { areConnected, validId };
