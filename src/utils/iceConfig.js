const { createHmac } = require("crypto");
function iceConfig(userId, env = process.env, now = Date.now()) {
  const urls = (value) => value.split(",").map((url) => url.trim()).filter(Boolean);
  const iceServers = [];
  if (env.STUN_URLS !== "") iceServers.push({ urls: urls(env.STUN_URLS || "stun:stun.l.google.com:19302") });
  if (env.TURN_URLS) {
    if (!env.TURN_SHARED_SECRET) throw new Error("TURN_SHARED_SECRET is required for TURN_URLS");
    // coturn / TURN REST API compatible, short-lived credentials; secret stays on the server.
    const username = `${Math.floor(now / 1000) + 86400}:${userId}`;
    iceServers.push({ urls: urls(env.TURN_URLS), username,
      credential: createHmac("sha1", env.TURN_SHARED_SECRET).update(username).digest("base64") });
  }
  return { iceServers, iceTransportPolicy: env.ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all" };
}
module.exports = { iceConfig };
