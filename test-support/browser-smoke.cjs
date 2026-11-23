// Optional integration smoke test. Uses fake users/database and simulated devices only.
// Run after building the sibling frontend. See VIDEO_CALLING.md for setup.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const User = require("../src/models/user");
const initializeSocket = require("../src/utils/socket");
const { userAuth } = require("../src/middlewares/auth");

async function main() {
  process.env.JWT_SECRET = "isolated-browser-smoke-test-only";
  process.env.STUN_URLS = ""; delete process.env.TURN_URLS;
  const A = "a".repeat(24), B = "b".repeat(24);
  const users = { [A]: { _id: A, firstName: "Alice", lastName: "Developer" }, [B]: { _id: B, firstName: "Bobby", lastName: "Builder" } };
  User.findById = (id) => { const query = Promise.resolve(users[id]); query.select = () => query; return query; };
  const messages = [];
  class Chat {
    constructor(data) { Object.assign(this, data); }
    static async findOne() { return new Chat({ messages }); }
    async save() {}
  }
  const api = express();
  api.use(cookieParser()); api.use(express.json());
  api.get("/profile/view", userAuth, (req, res) => res.json(req.user));
  api.get("/premium/verify", userAuth, (req, res) => res.json(req.user));
  api.get("/chat/:id", userAuth, (req, res) => res.json({ messages }));
  api.get("/user/connections", userAuth, (req, res) => res.json({ data: Object.values(users).filter((u) => u._id !== req.user._id) }));
  api.use(require("../src/routes/video"));
  const web = express();
  web.use("/api", api);
  const dist = path.resolve(process.env.FRONTEND_DIR || "../devTinder-web", "dist");
  web.use(express.static(dist)); web.get("/{*path}", (req, res) => res.sendFile(path.join(dist, "index.html")));
  const frontend = http.createServer(web);
  let io, videoCalls;
  const browsers = [];
  const artifacts = path.resolve(process.env.SMOKE_ARTIFACTS || ".video-work/screenshots"); fs.mkdirSync(artifacts, { recursive: true });
  // A deterministic file camera avoids host-specific fake-device/GPU behavior.
  const cameraFile = path.join(artifacts, "camera.y4m");
  const frames = [Buffer.from("YUV4MPEG2 W320 H240 F15:1 Ip A1:1 C420\n")];
  for (let i = 0; i < 30; i++) frames.push(Buffer.from("FRAME\n"), Buffer.alloc(320 * 240, 50 + i * 5), Buffer.alloc(320 * 240 / 4, 90), Buffer.alloc(320 * 240 / 4, 180));
  fs.writeFileSync(cameraFile, Buffer.concat(frames));
  try {
    await new Promise((resolve, reject) => frontend.once("error", reject).listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${frontend.address().port}`;
    process.env.CLIENT_ORIGINS = origin;
    ({ io, videoCalls } = initializeSocket(frontend, { Chat, areConnected: async (a, b) => Boolean(users[a] && users[b] && a !== b) }));
    api.locals.videoCalls = videoCalls;
    // Mirror the deployment's /api/socket.io -> /socket.io rewrite before Engine.IO sees each request.
    const rewrite = (req) => { req.url = req.url.replace(/^\/api\/socket\.io/, "/socket.io"); };
    frontend.prependListener("request", rewrite);
    frontend.prependListener("upgrade", rewrite);
    if (process.env.SMOKE_DEBUG) io.on("connection", (socket) => socket.onAny((event) => console.log("signal", String(socket.data.user._id)[0], event)));
    const errors = [];
    const pageFor = async (id, viewport) => {
      // Separate processes avoid sharing a simulated capture device between participants.
      const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH,
        headless: true, args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${cameraFile}`,
          "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
          "--autoplay-policy=no-user-gesture-required"] });
      browsers.push(browser);
      const context = await browser.newContext({ permissions: ["camera", "microphone"], viewport });
      await context.addCookies([{ name: "token", value: jwt.sign({ _id: id }, process.env.JWT_SECRET, { expiresIn: "1h" }), domain: "127.0.0.1", path: "/" }]);
      const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.testPeers = [];
        const Peer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Peer { constructor(config) { super(config); window.testPeers.push(this); } };
      });
      return page;
    };
    const a = await pageFor(A, { width: 1365, height: 900 });
    const b = await pageFor(B, { width: 390, height: 844 });
    await Promise.all([a.goto(`${origin}/chat/${B}`), b.goto(`${origin}/chat/${A}`)]);
    await a.getByRole("button", { name: "Start video call" }).waitFor();
    await a.getByRole("textbox", { name: "Message", exact: true }).fill("Chat before calling");
    await a.getByRole("button", { name: /Send/ }).click();
    await b.getByText("Chat before calling", { exact: true }).waitFor();
    // Incoming notification must work away from the chat route, too.
    await b.getByRole("link", { name: "Connections", exact: true }).click();
    await a.getByRole("button", { name: "Start video call" }).click();
    await b.getByRole("button", { name: "Accept call" }).click();
    for (const page of [a, b]) {
      await page.waitForFunction(() => {
        const video = document.querySelector(".video-remote video");
        return video?.videoWidth > 0 && video.currentTime > 0.5 && document.querySelector(".video-heading p")?.textContent.startsWith("Connected");
      }, null, { timeout: 20000 }).catch(async (error) => {
        for (const peerPage of [a, b]) console.error(await peerPage.evaluate(() => ({
          notice: document.querySelector(".video-toast")?.textContent,
          heading: document.querySelector(".video-heading")?.textContent,
          peers: window.testPeers.map((pc) => ({ connection: pc.connectionState, ice: pc.iceConnectionState, signaling: pc.signalingState })),
          videos: Array.from(document.querySelectorAll("video"), (v) => ({ width: v.videoWidth, time: v.currentTime, paused: v.paused })),
        })));
        console.error("Browser errors:", errors); throw error;
      });
      assert.equal(await page.locator(".video-remote video").evaluate((video) => video.srcObject.getAudioTracks()[0]?.readyState), "live");
      await page.evaluate(() => { window.testLocalTracks = document.querySelector(".video-local video").srcObject.getTracks(); });
    }
    await a.screenshot({ path: path.join(artifacts, "call-desktop.png") });
    await b.screenshot({ path: path.join(artifacts, "call-mobile.png") });
    await a.getByRole("button", { name: "Mute", exact: true }).click();
    assert.equal(await a.evaluate(() => window.testLocalTracks.find((t) => t.kind === "audio").enabled), false);
    await b.getByRole("button", { name: "Camera off", exact: true }).click();
    assert.equal(await b.evaluate(() => window.testLocalTracks.find((t) => t.kind === "video").enabled), false);
    await a.getByRole("button", { name: "End call", exact: true }).click();
    for (const page of [a, b]) await page.waitForFunction(() => !document.querySelector("dialog") && window.testLocalTracks.every((t) => t.readyState === "ended"));
    for (const page of [a, b]) await page.getByText("Call ended.", { exact: true }).waitFor();
    await Promise.all([a, b].map((page) => page.locator(".video-toast").waitFor({ state: "detached", timeout: 6000 })));
    await a.getByRole("textbox", { name: "Message", exact: true }).fill("Chat after calling");
    await a.getByRole("button", { name: /Send/ }).click();
    await a.getByText("Chat after calling", { exact: true }).waitFor();
    await a.getByRole("button", { name: "Start video call" }).click();
    await b.getByRole("button", { name: "Decline", exact: true }).click();
    await a.getByText("Call declined.", { exact: true }).waitFor();
    await a.getByRole("button", { name: "Dismiss call message" }).click();
    await a.locator(".video-toast").waitFor({ state: "detached" });
    await a.goto(`${origin}/premium`);
    await a.getByRole("heading", { name: "Silver", exact: true }).waitFor();
    await a.getByRole("heading", { name: "Unlimited video calls. For everyone.", exact: true }).waitFor();
    await a.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await a.screenshot({ path: path.join(artifacts, "premium-desktop.png"), fullPage: true });
    await b.goto(`${origin}/premium`);
    await b.getByRole("heading", { name: "Gold", exact: true }).waitFor();
    await b.screenshot({ path: path.join(artifacts, "premium-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS: real WebRTC media, controls, cleanup, chat, call-ended notice auto-dismissal on both peers, manual dismissal, unlimited free calling, Premium desktop/mobile, no browser errors.");
  } finally {
    await Promise.all(browsers.map((browser) => browser.close())); videoCalls?.close();
    if (io) await new Promise((resolve) => io.close(resolve));
    else await new Promise((resolve) => frontend.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
