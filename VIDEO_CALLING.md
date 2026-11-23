# Video calling: implementation, testing and production runbook

No production deployment or infrastructure changes have been performed.

Video calls are **unlimited for all signed-in users with accepted connections**, including free accounts. There are no daily or membership-based call quotas, usage counters, or quota collections. Silver and Gold retain their existing prices and payment behavior. The Premium UI now makes free calling explicit, with refreshed cards displaying the existing Silver ₹300 / 3 months and Gold ₹700 / 6 months prices. Keep these display prices aligned with `src/utils/constants.js`; checkout remains authoritative.

## Design and scope

The existing JWT `token` cookie now authenticates Socket.IO connections. The server derives identity and profile details from that cookie, checks the existing `ConnectionRequest` model for `accepted` in either direction, and assigns opaque call IDs itself. Chat event names and message shapes remain compatible; client-supplied names/user IDs no longer grant access. HTTP chat history also requires an accepted connection. JWT signing now uses the same `JWT_SECRET` as verification (the previous signer used a hardcoded key). No database schema or connection-request behavior changes are required.

One shared frontend socket lives under `Body`, survives route changes, and disconnects on logout/unmount. Incoming calls appear throughout the signed-in app. A native modal dialog provides keyboard focus containment, mobile layout, caller details, accept/decline, local/remote video, mute/camera controls, timer, status and errors. Capture begins after acceptance (the recipient first grants device permissions); no capture occurs for a declined incoming call. Permission requests cannot be aborted by browsers, so late streams are immediately stopped after cancellation.

Routine call notices (ended, declined, unanswered, answered elsewhere) dismiss automatically after one second; error notices remain for eight seconds. The close button dismisses either immediately. Starting a new call or replacing a notice cancels the previous notice timer.

Socket.IO carries invitation, SDP offer/answer and ICE candidates only. `RTCPeerConnection` transports audio/video directly between browsers, or via TURN when a direct path is unavailable. Media is not sent through Express, MongoDB, Nginx or Cloudflare. ICE candidates arriving before the remote description are buffered. Ending/unmounting closes the peer, stops tracks, clears timers and removes listeners.

The backend reserves both users atomically after asynchronous connection authorization. Calls ring for 30 seconds, have 45 seconds to establish media after acceptance, and a four-hour maximum duration. Both peers report connection success. A 12-second browser grace period handles temporary media disconnection; socket disconnection ends the call immediately. Expired JWTs disconnect the socket. Multiple tabs can receive an invitation; the first successful acceptance owns the call and other tabs dismiss it. Signaling is restricted to the initiating and accepting sockets, with direction/phase/payload validation and bounded ICE candidate counts.

**Deployment requirement:** the in-memory registry requires **one Node process / one PM2 instance**, consistent with the repository's documented `pm2 start npm --name devTinder-backend -- start`. Restarting it ends active calls. Multiple instances would require shared atomic call state, presence and a Socket.IO adapter; do not enable cluster mode with this implementation. Incoming notifications require an open, connected app tab; there is no push service or background mobile calling.

## Files changed

Backend:

| File | Purpose |
| --- | --- |
| `src/utils/videoCalls.js` | Invitation lifecycle, busy/presence registry, timers and signaling authorization |
| `src/utils/socketAuth.js` | Existing JWT cookie authentication for sockets |
| `src/utils/connections.js` | Accepted-connection authorization shared by chat and calls |
| `src/utils/iceConfig.js` | STUN configuration and expiring TURN credentials |
| `src/routes/video.js` | Authenticated, active-call-only `GET /video/ice` with `no-store` |
| `src/config/origins.js` | Shared HTTP/socket origin allowlist |
| `src/utils/socket.js` | Integrates calls, authenticates chat and prevents stale chat joins |
| `src/routes/chat.js` | Authorizes history and returns errors instead of hanging |
| `src/models/user.js` | Uses configured JWT signing secret; schema unchanged |
| `src/app.js` | Mounts video route and registry; shares CORS origins |
| `.env.local.example` | Public configuration placeholders |
| `package.json`, `package-lock.json` | Test command and test-only Socket.IO client dependency |
| `test/video.test.js` | Auth, signaling, lifecycle, races, ICE endpoint and chat regression tests |
| `test-support/browser-smoke.cjs` | Optional isolated two-browser simulated-device smoke test |
| `.gitignore` | Ignores local preparation/browser artifacts in `.video-work/` |
| `README.md`, `VIDEO_CALLING.md` | Feature and operational documentation |

Frontend (`../devTinder-web`):

| File | Purpose |
| --- | --- |
| `src/components/Body.jsx` | App-wide, user-scoped video provider |
| `src/components/Chat.jsx` | Video button, shared socket, authorized join/message acknowledgements, route reset |
| `src/utils/socket.js` | Credentialed socket with explicit lifecycle |
| `src/utils/videoCall.js` | Testable media/signaling controller and cleanup |
| `src/utils/videoContext.js` | Shared call context |
| `src/components/VideoProvider.jsx` | React subscription and credentialed ICE fetch |
| `src/components/VideoCallOverlay.jsx`, `videoCall.css` | Responsive accessible call interface |
| `src/components/Premium.jsx`, `premium.css` | Redesigned plan cards and an explicit unlimited-calling-for-everyone banner |
| `test/videoCall.test.js` | Device permission, ICE ordering, lifecycle and cleanup tests |
| `package.json`, `eslint.config.js` | Test command and test-file lint environment |

No new runtime dependencies. The backend adds `socket.io-client` as a **devDependency** for real transport tests. Frontend production dependencies are unchanged. The optional browser smoke test uses `playwright-core` separately; it is not part of either production application.

## Configuration

Only the backend `.env` needs these settings; never put TURN secrets in `VITE_*` variables or source code. The app reads `.env`, not `.env.local`.

| Variable | Value / behavior |
| --- | --- |
| `CLIENT_ORIGINS` | Comma-separated exact origins; default `http://localhost:5173,https://devtinder.work`. Include any actual additional origin only if used. |
| `STUN_URLS` | Default `stun:stun.l.google.com:19302`; comma-separated STUN URLs; empty disables STUN. |
| `TURN_URLS` | Provider-supplied comma-separated `turn:`/`turns:` URLs, including transports/ports. Empty disables relay. |
| `TURN_SHARED_SECRET` | Backend-only TURN REST/coturn-compatible HMAC-SHA1 shared secret. Required if `TURN_URLS` is set. |
| `ICE_TRANSPORT_POLICY` | `all` normally; `relay` for a forced-TURN acceptance test. |
| `JWT_SECRET` | Existing variable, now used for both signing and verification. A changed value requires users to sign in again. |

TURN usernames expire in 24 hours and contain the user ID; passwords are HMAC-derived. Only temporary credentials reach authenticated participants in an active call. The shared secret never leaves the backend. Calls are capped below credential lifetime. Choose a provider supporting this TURN REST convention; arbitrary static username/password or vendor token APIs are not interchangeable. Apply provider quota and abuse controls. STUN alone cannot guarantee calls across carrier NATs or enterprise firewalls. Managed TURN is the practical option when keeping EC2 unchanged; self-hosted coturn is also possible but requires separate configuration, bandwidth capacity, ports and firewall work that is not included here.

Events: `initiateCall`, `incomingCall`, `callRinging`, `acceptCall`, `callAccepted`, `rejectCall`, `callDismissed`, `webrtcOffer`, `webrtcAnswer`, `iceCandidate`, `callConnected`, `endCall`, `callEnded`. Client requests receive `{ok:true,...}` or `{ok:false,error}` acknowledgements. `callEnded` supplies a reason such as `declined`, `timeout`, `connectionTimeout` or `disconnected`. Keep call IDs and media descriptions out of production logs.

## Local verification

Use a Node runtime compatible with the existing locks. Verified here with Node **22.20.0**. Installed Vite requires `^20.19.0 || >=22.12.0`; Mongoose requires `>=20.19.0`. The old frontend README's Node 16 instruction is obsolete.

```sh
# Backend; configure your private development .env first, without overwriting it.
cd /path/to/devTinder
npm ci
npm test
npm start

# Separate terminal
cd /path/to/devTinder-web
npm ci
npm test
npm run lint
npm run build
npm run dev
```

Open `http://localhost:5173` in two separate browser profiles, sign in as distinct developers and accept their connection. Test call, acceptance, two-way media, mute, camera toggle and hangup. An unconnected user must receive a server denial even if they manually emit events or enter a chat URL. The backend tests run with stubbed database methods and real HTTP/Socket.IO/JWT handling; they do not load `.env` or access Atlas. They are not a substitute for a real database smoke test of signup/login, request acceptance and persisted chat.

Optional browser smoke test (requires Chrome and a built sibling frontend; chooses an isolated local port automatically):

```sh
cd /path/to/devTinder
npm install --prefix .video-work/browser --no-save --package-lock=false playwright-core
PLAYWRIGHT_MODULE="$PWD/.video-work/browser/node_modules/playwright-core" \
BROWSER_PATH=/usr/bin/google-chrome \
node test-support/browser-smoke.cjs
```

Set `FRONTEND_DIR` if the frontend is elsewhere. On Windows PowerShell set `PLAYWRIGHT_MODULE` and `BROWSER_PATH` using `$env:...` before running Node. This harness serves only fake users/data on an automatically assigned loopback port, uses headless Chrome with simulated cameras, exercises the actual built React UI and real WebRTC peers, and writes screenshots under ignored `.video-work/screenshots/`. It never loads production credentials. It does not prove cross-network relay connectivity or physical-device capture quality.

## Two-device / separate-network acceptance checklist

1. Use a staging HTTPS URL (or the live URL only after an authorized deployment). Plain HTTP LAN IPs are not a substitute for HTTPS camera access. On one laptop use home Wi-Fi; on another device use cellular/hotspot or another network. Use headphones.
2. Sign in as A and B, send and accept the existing connection request, then verify saved chat in both directions. Keep B on Connections/Feed and call from A's chat header: B must receive caller details there.
3. Accept on B; allow camera/mic on both. Verify audible speech and moving remote video both ways, increasing duration, mute/unmute, camera off/on, and both participants' end-call buttons. Confirm browser capture indicators stop after hangup.
4. Decline, ignore for 30 seconds, call an offline user, close either tab during ringing/connected states, disable network, log out, and retry. No busy reservation or capture should remain. A brief media-only network interruption can recover within 12 seconds; signaling loss ends the call.
5. Deny camera/mic, unplug a camera, or occupy it in another app. Check useful errors and cleanup on the other peer. Cancel while a permission prompt is open, then grant it: tracks must stop immediately.
6. Click call nearly simultaneously on both devices; open multiple tabs as B and accept in one. Only one call/answering tab should remain. Try a third user and forged call IDs/roles: the backend must reject them.
7. Set backend `ICE_TRANSPORT_POLICY=relay`, restart the single backend process, and start a fresh call. In Chromium `chrome://webrtc-internals` inspect the selected candidate pair: a relay candidate must be selected. Confirm audio/video on separate networks, then restore `all` and restart. If relay-only fails, do not claim production cross-network readiness; fix TURN URLs, shared secret, supported TLS/TCP transport and provider reachability.
8. Repeat on actual mobile Safari and Android Chrome, including audio playback prompts, orientation, permissions and tab suspension. A closed/suspended app has no background push notification support.
9. Recheck feed, profile, requests/accept/reject, chat persistence after refresh, signup/login/logout, and Razorpay **test-mode** flow. This feature does not modify payment handlers.

## Existing EC2/Nginx assessment

The frontend README documents `/var/www/html` static assets, `/etc/nginx/sites-available/default`, backend port 7777, and PM2 process `devTinder-backend`. Its proxy block is:

```nginx
location /api/ {
    proxy_pass http://localhost:7777/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

This maps browser `/api/socket.io` to server `/socket.io`, including WebSocket upgrades, and maps `/api/video/ice` to the new route. It already supports the new signaling events: **no new Socket.IO endpoint or Nginx location is required**. Confirm the actual server matches it. Socket.IO's default heartbeat is 25s + 20s; Nginx's effective `proxy_read_timeout` must exceed 45 seconds (60s normally suffices). Do not edit a working proxy merely to add events.

Existing EC2 inbound HTTPS rules suffice with managed TURN: the browsers exchange media directly or connect to the TURN provider; EC2 does not relay it. No new inbound UDP range or public port 7777 is needed. Actual AWS security-group rules were not accessible here. Self-hosting TURN would change that assessment and is outside this runbook. Keep domain, GoDaddy nameservers, Cloudflare DNS and current TLS setup unchanged. Browser camera/mic require a secure context; valid HTTPS at `https://devtinder.work` supports this, subject to user permissions and browser policy. The live TLS/proxy/PM2 state was not inspected from the local checkout.

References: [Socket.IO proxy requirements](https://socket.io/docs/v4/reverse-proxy/), [browser capture security](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection), [PM2 process management](https://pm2.keymetrics.io/docs/usage/process-management/).

## Ubuntu deployment commands — run only after review and release commits

These changes are uncommitted locally. Review, commit and push **both** repos first. The actual EC2 checkout locations and release SHAs are not in version-controlled configuration; replace the four values below with your confirmed locations and reviewed commits. The process name and static root follow the existing README; verify them before copying files. Do not deploy if PM2 is running multiple instances.

```bash
# On the existing EC2 host, as the account already managing PM2:
set -euo pipefail
BACKEND_DIR=/home/ubuntu/devTinder       # verify using pm2 describe below
FRONTEND_DIR=/home/ubuntu/devTinder-web # verify the existing checkout
BACKEND_RELEASE=REPLACE_WITH_REVIEWED_BACKEND_COMMIT
FRONTEND_RELEASE=REPLACE_WITH_REVIEWED_FRONTEND_COMMIT
STATIC_ROOT=/var/www/html              # verify against nginx -T

pm2 list
pm2 describe devTinder-backend
node --version
npm --version
sudo nginx -t
sudo nginx -T 2>&1 | grep -E 'server_name|root |location /api|proxy_pass|proxy_http_version|proxy_set_header|proxy_read_timeout'
# Confirm one PM2 fork instance, the checkout paths, static root, proxy mapping,
# a compatible Node runtime, and the current HTTPS site before continuing.

test -z "$(git -C "$BACKEND_DIR" status --porcelain)"
test -z "$(git -C "$FRONTEND_DIR" status --porcelain)"
BACKUP="$HOME/devtinder-release-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$BACKUP"
git -C "$BACKEND_DIR" rev-parse HEAD > "$BACKUP/backend.sha"
git -C "$FRONTEND_DIR" rev-parse HEAD > "$BACKUP/frontend.sha"
cp "$BACKEND_DIR/.env" "$BACKUP/backend.env"
chmod 600 "$BACKUP/backend.env"
sudo tar -C "$STATIC_ROOT" -czf "$BACKUP/frontend-static.tgz" .
printf 'Keep this private rollback directory: %s\n' "$BACKUP"

# Update private server configuration interactively; never paste secrets into Git.
nano "$BACKEND_DIR/.env"
# Add CLIENT_ORIGINS=https://devtinder.work and your provider's TURN settings.
# Keep the existing JWT_SECRET unless deliberately rotating it; rotation signs users out.
# Keep ICE_TRANSPORT_POLICY=all outside the explicit relay validation step.

git -C "$BACKEND_DIR" fetch origin
git -C "$BACKEND_DIR" switch --detach "$BACKEND_RELEASE"
git -C "$FRONTEND_DIR" fetch origin
git -C "$FRONTEND_DIR" switch --detach "$FRONTEND_RELEASE"

cd "$BACKEND_DIR"
npm ci --include=dev
npm test
cd "$FRONTEND_DIR"
npm ci --include=dev
npm test
npm run lint
npm run build

# Both test suites and the build must succeed before these activation steps.
# Restart briefly interrupts chat and ends active calls; schedule a quiet window.
cd "$BACKEND_DIR"
pm2 restart devTinder-backend --update-env
pm2 status devTinder-backend
pm2 logs devTinder-backend --lines 50 --nostream
sudo cp -a "$FRONTEND_DIR/dist/." "$STATIC_ROOT/"
# Old hashed assets are retained for already-open tabs and safe rollback.
# No nginx restart, DNS change, database migration or security-group edit is required.

curl -fsS 'https://devtinder.work/api/socket.io/?EIO=4&transport=polling'
# Expect an Engine.IO opening packet beginning with 0 and a sid.
curl -sS -o /dev/null -w '%{http_code}\n' https://devtinder.work/api/video/ice
# Expect 401 without a login cookie, not a static HTML page/404/502.
```

Reload both browsers, sign in, and complete the separate-network checklist above, including forced relay, chat and payment smoke tests. An open Engine.IO transport is not proof of authenticated Socket.IO access; verify browser signaling and UI too. Keep all call paths on one PM2 instance. After successful verification, `pm2 save` persists the existing process list; it is not a substitute for restarting with the correct environment. If environment variables are also set in a PM2 ecosystem file, align them there—dotenv does not override existing process variables. Do not print environment values to diagnose this.

## Rollback

Use the same shell variables or restore them to verified paths and set `BACKUP` to the saved private directory. Rollback interrupts calls. Both repositories and static assets must be restored together; no database migration needs reversal.

```bash
set -euo pipefail
git -C "$BACKEND_DIR" switch --detach "$(cat "$BACKUP/backend.sha")"
git -C "$FRONTEND_DIR" switch --detach "$(cat "$BACKUP/frontend.sha")"
cp "$BACKUP/backend.env" "$BACKEND_DIR/.env"
chmod 600 "$BACKEND_DIR/.env"
cd "$BACKEND_DIR"
npm ci
pm2 restart devTinder-backend --update-env
sudo tar -xzf "$BACKUP/frontend-static.tgz" -C "$STATIC_ROOT"
pm2 status devTinder-backend
pm2 logs devTinder-backend --lines 50 --nostream
curl -fsS 'https://devtinder.work/api/socket.io/?EIO=4&transport=polling'
```

Recheck login and chat, refresh clients, and persist with `pm2 save` once healthy. If you changed ecosystem/PM2 environment variables separately, restore those too. Retaining extra content-hashed assets is harmless; avoid destructive blanket deletion of the static root. Keep the private backup out of Git and web-accessible directories.

## Validation results and remaining limits

Verified on 2026-11-23 with Node 22.20.0:

| Check | Actual result |
| --- | --- |
| Backend `npm test` | **21 passed, 0 failed**; real local Socket.IO/HTTP transports and JWTs, stubbed database, including repeated accepted calls between free accounts |
| Frontend `npm test` | **8 passed, 0 failed**; injected media/peer lifecycle APIs |
| Frontend `npm run lint` | **Passed**, no lint errors |
| Frontend `npm run build` | **Passed**, Vite production build |
| `node test-support/browser-smoke.cjs` | **Passed**, two separate Chrome processes with deterministic simulated cameras, real WebRTC, received moving video/live audio tracks, incoming notification outside chat, mute/camera controls, hangup cleanup, decline, chat before/after; no browser runtime errors; redesigned Premium cards also inspected |
| Visual inspection | Desktop 1365×900 and mobile 390×844 screenshots inspected; dialog and controls fit both layouts |
| Git whitespace checks | Passed in both repositories |

Initial test execution was blocked by Windows sandbox `spawn EPERM`; it passed when run with approved subprocess permissions. A later browser check found the development backend already using port 7777; the harness was changed to an automatically assigned isolated port without stopping the running app. The initial offline test-dependency installation failed with `ENOTCACHED`; the approved online installation succeeded. Two early browser smoke attempts timed out with the host's default fake camera (first missing device, then connected peers but no remote frames). The harness now uses separate Chrome processes and an explicit generated Y4M camera file; the final run passed. These failures and the test-only harness changes are not evidence of physical-camera or cross-network validation.

The dependency installation reported **5 audit findings** (1 moderate, 2 high, 2 critical) in the backend dependency tree. No broad dependency upgrades were applied as part of video calling; inspect `npm audit` separately before release. An offline audit is not an authoritative vulnerability check.

Real separate-network devices, actual TURN provider credentials, Atlas persistence, production AWS/PM2/Nginx settings and real payment flows still require the manual acceptance steps. Audio tracks were checked programmatically; audible quality needs the two-device test. Existing unrelated authentication response/logging, password-edit and payment hardening issues listed in the README remain outside this change. No production environment file was read or modified, no secrets were committed, and nothing was deployed.
