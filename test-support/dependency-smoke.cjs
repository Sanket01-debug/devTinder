// Optional real-driver compatibility check. Never loads .env or connects to Atlas.
// MONGOMS_MODULE must point to a separately installed mongodb-memory-server package.
const assert = require("node:assert/strict");
const http = require("node:http");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const express = require("express");
const cookieParser = require("cookie-parser");
const { io: connect } = require("socket.io-client");
const { MongoMemoryServer } = require(process.env.MONGOMS_MODULE || "mongodb-memory-server");
const User = require("../src/models/user");
const Connection = require("../src/models/connectionRequest");
const { Chat } = require("../src/models/chat");
const initializeSocket = require("../src/utils/socket");
const { userAuth } = require("../src/middlewares/auth");
const Razorpay = require("razorpay");
const { validateWebhookSignature } = require("razorpay/dist/utils/razorpay-utils");

async function main() {
  process.env.JWT_SECRET = "isolated-dependency-smoke-only";
  process.env.EMAIL_ENABLED = "false";
  const db = await MongoMemoryServer.create({ instance: { dbName: "dependency_smoke", ip: "127.0.0.1" } });
  let server, io, calls; const sockets = [];
  try {
    await mongoose.connect(db.getUri());
    const password = "IsolatedTest!42";
    const hash = await bcrypt.hash(password, 10);
    const a = await User.create({ firstName: "Alice", lastName: "Test", emailId: "alice@example.test", password: hash });
    const b = await User.create({ firstName: "Bobby", lastName: "Test", emailId: "bobby@example.test", password: hash });
    assert.equal(await a.validatePassword(password), true);
    const request = await Connection.create({ fromUserId: a._id, toUserId: b._id, status: "interested" });
    request.status = "accepted"; await request.save();
    await assert.rejects(Connection.create({ fromUserId: a._id, toUserId: a._id, status: "accepted" }), /yourself/);
    a.about = "Updated using Mongoose 9"; await a.save();
    assert.equal((await User.findById(a._id)).about, a.about);
    const app = express(); app.use(express.json()); app.use(cookieParser());
    app.use(require("../src/routes/auth"));
    app.use(require("../src/routes/chat"));
    app.get("/protected", userAuth, (req, res) => res.json({ id: req.user._id }));
    app.post("/echo", (req, res) => res.json(req.body));
    app.post("/v1/orders", (req, res) => res.redirect(307, "/v1/order-result"));
    app.post("/v1/order-result", (req, res) => {
      assert.equal(req.headers.authorization, `Basic ${Buffer.from("test_id:test_secret").toString("base64")}`);
      assert.equal(req.body.amount, 30000);
      res.json({ id: "order_local", amount: req.body.amount, currency: req.body.currency, status: "created" });
    });
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: "Rejected test request" }));
    server = http.createServer(app);
    ({ io, videoCalls: calls } = initializeSocket(server));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${origin}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailId: a.emailId, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${origin}/protected`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${origin}/protected`)).status, 401);
    const json = Buffer.from(JSON.stringify({ message: "compressed body accepted" }));
    const compressed = await fetch(`${origin}/echo`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: zlib.gzipSync(json) });
    assert.equal((await compressed.json()).message, "compressed body accepted");
    const malformed = await fetch(`${origin}/echo`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: Buffer.from("not gzip") });
    assert.equal(malformed.status, 400);
    const trailing = await fetch(`${origin}/echo`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: Buffer.concat([zlib.gzipSync(json), Buffer.from("bad trailing data")]) });
    assert.equal(trailing.status, 400);
    assert.equal((await fetch(`${origin}/protected`)).status, 401); // Process survives malformed compression.
    const socketFor = async (tokenCookie) => {
      const s = connect(origin, { extraHeaders: { Cookie: tokenCookie }, transports: ["websocket"], reconnection: false }); sockets.push(s);
      await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); }); return s;
    };
    const sa = await socketFor(cookie), sb = await socketFor(`token=${await b.getJWT()}`);
    const emit = (s, event, data) => s.timeout(3000).emitWithAck(event, data);
    assert.equal((await emit(sa, "joinChat", { targetUserId: String(b._id) })).ok, true);
    assert.equal((await emit(sb, "joinChat", { targetUserId: String(a._id) })).ok, true);
    const delivered = new Promise((resolve) => sb.once("messageReceived", resolve));
    assert.equal((await emit(sa, "sendMessage", { targetUserId: String(b._id), text: "Persisted message" })).ok, true);
    assert.equal((await delivered).text, "Persisted message");
    const stored = await Chat.findOne({ participants: { $all: [a._id, b._id] } }).populate("messages.senderId");
    assert.equal(stored.messages[0].senderId.firstName, "Alice");
    const history = await fetch(`${origin}/chat/${b._id}`, { headers: { Cookie: cookie } });
    assert.equal((await history.json()).messages[0].text, "Persisted message");
    const call = await emit(sa, "initiateCall", { targetUserId: String(b._id) }); assert.equal(call.ok, true);
    assert.equal((await emit(sb, "acceptCall", { callId: call.callId })).ok, true);
    assert.equal((await emit(sa, "webrtcOffer", { callId: call.callId, description: { type: "offer", sdp: "local-test" } })).ok, true);
    assert.equal((await emit(sb, "webrtcAnswer", { callId: call.callId, description: { type: "answer", sdp: "local-test" } })).ok, true);
    await emit(sa, "endCall", { callId: call.callId });
    const razorpay = new Razorpay({ key_id: "test_id", key_secret: "test_secret" });
    razorpay.api.rq.defaults.baseURL = origin; razorpay.api.rq.defaults.proxy = false;
    razorpay.api.rq.interceptors.request.use((config) => { assert.equal(config.baseURL, origin); return config; });
    assert.equal((await razorpay.orders.create({ amount: 30000, currency: "INR", receipt: "local" })).id, "order_local");
    const body = JSON.stringify({ event: "payment.captured", local: true });
    const signature = crypto.createHmac("sha256", "test_webhook").update(body).digest("hex");
    assert.equal(validateWebhookSignature(body, signature, "test_webhook"), true);
    assert.equal(validateWebhookSignature(body, "invalid", "test_webhook"), false);
    console.log("PASS: real ephemeral MongoDB create/update/query/populate, JWT login/cookies, bcrypt, accepted connections, persisted socket chat/history, WebRTC signaling, compressed JSON/malformed-body survival, Razorpay SDK order/307 redirect and webhook signature compatibility. No Atlas or Razorpay network calls.");
  } finally {
    sockets.forEach((s) => s.disconnect()); calls?.close();
    if (io) await new Promise((resolve) => io.close(resolve));
    else if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect(); await db.stop();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
