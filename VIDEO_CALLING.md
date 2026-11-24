# Video calling: implementation, testing and production runbook

## Release review — 2026-11-24

**Security fixes are approved, committed and pushed to GitHub main in both repositories; neither deployment approval stage has been executed.** Both remote main refs were verified at the security commit hashes after pushing on 2026-11-24. The pinned security commits below are the deployment releases. A separate backend documentation commit records those already-known hashes. Production configuration, PM2, Nginx and deployed files remain unchanged. Server facts below come from the earlier read-only inspection on 2026-11-23; this dependency-remediation pass made no production connection. The commands below require the corresponding explicit approval and supersede the earlier in-place installation plan.

### Security audit and release gate

Fresh online audits on 2026-11-24 report **zero vulnerabilities in both repositories**, both with all dependencies and with `--omit=dev`. Both clean `npm ci` installs succeeded. No `npm audit fix --force`, dependency overrides or direct major-version upgrades were used.

| Audit scope | Before fixes | After fixes |
| --- | --- | --- |
| Backend, production and full tree | 2 critical, 2 high, 1 moderate | **0** |
| Frontend, production | 4 high | **0** |
| Frontend, full tree | 12 high, 5 moderate | **0** |

These counts are npm package findings, not distinct exploitable vulnerabilities. A clean audit covers known registry advisories at the time checked, not all application security issues. The following table preserves the original production findings and reachability assessment; the local versions have now been patched as listed in the next section.

The four backend packages below had the **same affected installed versions on EC2** as in the original release lockfile. Production remains unchanged and still needs the approved release. Reachability assessment is source review, not a penetration test:

| Package / installed version | Severity and advisory | Application impact / release action |
| --- | --- | --- |
| `mongoose` 9.6.3 | Critical aggregate; [countDocuments sanitization bypass](https://github.com/advisories/GHSA-pcrw-h46h-c93h), plus other high/moderate casting/prototype advisories | App uses Mongoose for user input and database queries. No `countDocuments`, connection `sanitizeFilter`, or discriminator usage was found, so the critical advisory's specific path was not demonstrated. This does not clear the other findings. Upgrade to a currently patched 9.x release, at least 9.11.4 for the reported set, and retest before activation. |
| `proxy-addr` 2.0.7, via Express | Critical: [IPv4-mapped IPv6 trust-subnet spoofing](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) | No Express `trust proxy` setting or IP-based authorization was found. The vulnerable trust-subnet configuration is not presently established; simply being behind Nginx is not enough to demonstrate exploitation. Update to at least 2.0.8 before release; do not enable broad proxy trust as a workaround. |
| `body-parser` 2.2.2, via Express | High: [compressed-body trailing-byte DoS](https://github.com/advisories/GHSA-27r3-jxmh-p828); also a low invalid-limit advisory | Global `express.json()` accepts request bodies before route authentication. This is the clearest reachable risk; fix before release. Update to at least 2.4.0 and verify JSON, compressed/malformed bodies and the payment webhook. No malicious request was sent to production. |
| `follow-redirects` 1.16.0, via Razorpay → Axios | High: [cross-realm sensitive-header handling](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p), plus array-header/regex advisories | Runs in payment HTTP requests. Current SDK uses object headers/basic authentication and the configured Razorpay endpoint; no custom cross-realm `sensitiveHeaders` or attacker-selected redirect destination was found. Exploitation is not demonstrated, but credentials make this worth fixing before release. Update to a patched version beyond 1.16.1 and test order creation in Razorpay test mode. |

The original remediation also required backend `qs` 6.15.2 to move beyond 6.16.0. Original frontend findings: Axios 1.18.1 (Node-adapter vulnerabilities are not browser-runtime paths; prototype-pollution gadgets need a separate pollution source), follow-redirects 1.16.0 (Node-only transport, not the browser adapter), and React Router/DOM 7.18.1 (reported RSC action vulnerability; this app is a static BrowserRouter SPA, not an RSC server). The advisory thresholds were Axios 1.20.0 and router packages 7.18.2, plus patched transitive dependencies; these are now installed and audited. These are minimum advisory thresholds, not a promise that those exact versions remain free of future advisories.

### Completed dependency fixes

Versions below are exact installed lockfile versions, not the previous manifest's lower bounds.

| Project / dependency path | Before → after |
| --- | --- |
| Backend → mongoose | 9.6.3 → **9.11.4** |
| Backend → mongoose → mongodb | 7.2.0 → **7.7.0** |
| Backend → express → proxy-addr | 2.0.7 → **2.0.8** |
| Backend → express → body-parser | 2.2.2 → **2.4.0** |
| Backend → express / body-parser → qs | 6.15.2 → **6.17.1** |
| Backend → razorpay 2.9.8 → axios 1.20.0 → follow-redirects | 1.16.0 → **1.16.3**; SDK and backend Axios unchanged |
| Frontend → axios | 1.18.1 → **1.20.0** |
| Frontend → axios → follow-redirects | 1.16.0 → **1.16.3** |
| Frontend → react-router-dom → react-router | Both 7.18.1 → **7.18.2** |
| Frontend dev → eslint | 10.7.0 → **10.15.0** |
| Frontend dev → eslint → @eslint/config-array | 0.23.5 → **0.23.6** |
| Frontend dev → eslint / @eslint/config-array → minimatch → brace-expansion | minimatch 10.2.5 → **11.0.9**; brace-expansion 5.0.8 → **5.0.13** |
| Frontend dev → vite | 8.1.5 → **8.1.6** |
| Frontend dev → postcss | 8.5.22 → **8.5.23** |
| Frontend dev → postcss → nanoid / source-map-js | nanoid 3.3.16 → **3.3.20**; source-map-js 1.2.1 → **1.2.4** |
| Frontend dev → tailwindcss / postcss-nested → postcss-selector-parser | 6.1.4 → **6.1.6** |
| Frontend dev → eslint-plugin-react-hooks → zod | 4.4.3 → **4.6.7** |
| Frontend dev → css → source-map-resolve → decode-uri-component | Removed unused css **3.0.0** and its unused subtree, including source-map-resolve **0.6.0** and decode-uri-component **0.2.2** |

The `css` npm JavaScript parser had no imports in source, tests or configuration. Stylesheet imports still use Vite/PostCSS/Tailwind; the build and browser smoke test pass without that parser. This avoids the audit's proposed incompatible downgrade to css 2.x. Remaining transitive changes are recorded below for lockfile review. Some transitive major versions changed because the patched Mongoose and ESLint releases require them; no major versions were forced outside their parents' declared ranges. Node 22.20.0 satisfies the installed runtime/tool engine requirements.

<details>
<summary>Complete lockfile version changes (including supporting transitive packages)</summary>

**Backend**

| Package path under node_modules | Before | After |
| --- | --- | --- |
| `@mongodb-js/saslprep` | 1.4.11 | 1.6.3 |
| `@standard-schema/spec` | absent | 1.1.0 |
| `body-parser` | 2.2.2 | 2.4.0 |
| `body-parser/node_modules/content-type` | absent | 2.1.0 |
| `bson` | 7.2.0 | 7.3.4 |
| `follow-redirects` | 1.16.0 | 1.16.3 |
| `iconv-lite` | 0.7.2 | 0.7.3 |
| `kareem` | 3.3.0 | 3.4.1 |
| `mongodb` | 7.2.0 | 7.7.0 |
| `mongodb-connection-string-url` | 7.0.1 | 7.0.3 |
| `mongoose` | 9.6.3 | 9.11.4 |
| `mquery` | 6.0.0 | 6.0.1 |
| `object-inspect` | 1.13.4 | 1.14.0 |
| `proxy-addr` | 2.0.7 | 2.0.8 |
| `qs` | 6.15.2 | 6.17.1 |
| `side-channel` | 1.1.0 | 1.1.1 |
| `tr46` | 5.1.1 | 6.0.0 |
| `webidl-conversions` | 7.0.0 | 8.0.1 |
| `whatwg-url` | 14.2.0 | 15.1.0 |

**Frontend**

| Package path under node_modules | Before | After |
| --- | --- | --- |
| `@cacheable/memory` | absent | 2.2.0 |
| `@cacheable/utils` | absent | 2.5.0 |
| `@eslint/config-array` | 0.23.5 | 0.23.6 |
| `@eslint/config-helpers` | 0.6.0 | 0.7.0 |
| `@eslint/plugin-kit` | 0.7.2 | 0.7.3 |
| `@isaacs/nonrecursive-glob-match` | absent | 1.1.0 |
| `@keyv/bigmap` | absent | 1.3.1 |
| `@keyv/serialize` | absent | 1.1.1 |
| `atob` | 2.1.2 | removed |
| `axios` | 1.18.1 | 1.20.0 |
| `brace-expansion` | 5.0.8 | 5.0.13 |
| `cacheable` | absent | 2.5.0 |
| `css` | 3.0.0 | removed |
| `decode-uri-component` | 0.2.2 | removed |
| `eslint` | 10.7.0 | 10.15.0 |
| `file-entry-cache` | 8.0.0 | 11.1.5 |
| `flat-cache` | 4.0.1 | 6.1.23 |
| `flatted` | 3.4.3 | 3.4.4 |
| `follow-redirects` | 1.16.0 | 1.16.3 |
| `hashery` | absent | 1.5.1 |
| `hookified` | absent | 1.15.1 |
| `inherits` | 2.0.4 | removed |
| `json-buffer` | 3.0.1 | removed |
| `keyv` | 4.5.4 | 5.6.0 |
| `minimatch` | 10.2.5 | 11.0.9 |
| `nanoid` | 3.3.16 | 3.3.20 |
| `postcss` | 8.5.22 | 8.5.23 |
| `postcss-selector-parser` | 6.1.4 | 6.1.6 |
| `qified` | absent | 0.10.1 |
| `qified/node_modules/hookified` | absent | 2.2.0 |
| `react-router` | 7.18.1 | 7.18.2 |
| `react-router-dom` | 7.18.1 | 7.18.2 |
| `set-cookie-parser` | 2.7.2 | 2.7.3 |
| `source-map` | 0.6.1 | removed |
| `source-map-js` | 1.2.1 | 1.2.4 |
| `source-map-resolve` | 0.6.0 | removed |
| `vite` | 8.1.5 | 8.1.6 |
| `zod` | 4.4.3 | 4.6.7 |

</details>

**Release gate:** the user approved committing and pushing the tested fixes on 2026-11-24. The pinned release commits below contain those fixes; the subsequent documentation-only backend commit does not change application code or dependencies. Stage 1 is prepared for review but is **not authorized or executed**. Stage 2 requires another explicit approval after preparation succeeds. Rerun audits during preparation; any new finding must be reviewed before proceeding. Production remains on its previously inspected commits.

### Verified server, capacity and release identity

| Item | Verified value |
| --- | --- |
| SSH | `ubuntu@15.206.165.64`, existing key `C:\Users\sanke\Downloads\devTinder-secret.pem` |
| Backend | `/home/ubuntu/devTinder`, clean main; running commit `aa20a6d592d3115b158c65117790cc6cacf24a49` |
| Frontend source | `/home/ubuntu/devTinder-web`, clean main; deployed source commit `14ed073c9e99809c1ec9031429e211d3d921f486` |
| Backend pre-fix HEAD; GitHub verified in earlier inspection | `c685b1ae0ad1db1bc3d2a4b0bad8b134b37c6181`; **not the fixed release** |
| Frontend pre-fix HEAD; GitHub verified in earlier inspection | `eeaaaa9cf2790ffe568b94dd98d629aa46d0d3f2`; **not the fixed release** |
| Fixed backend release | `e3ab9836ea7fb62af439793c1f7a9ae87746a4fe` ? `Fix dependency vulnerabilities` |
| Fixed frontend release | `f87312e779202cd2ebfc18d0ba6a50f76b2226ae` ? `Fix dependency vulnerabilities` |
| PM2 | `devtinder-backend`, online, one fork instance; cwd is backend checkout |
| Runtime | NVM Node 22.20.0 / npm 10.9.3 |
| Nginx | `/etc/nginx/sites-enabled/default`; static `/var/www/html`; SPA fallback; `/api/` strips prefix and proxies to port 7777 with WebSocket upgrade headers |
| Static ownership | root:root, directories 755, files 644 |
| rsync | `/usr/bin/rsync`, **3.4.1**, verified |
| Free disk / inodes | **3,126,882,304 bytes (~2.91 GiB)**; 708,243 free inodes |
| Existing sizes | Static 2.73 MiB; backend dependencies 38.52 MiB; frontend dependencies 137.28 MiB; frontend dist 0.42 MiB; npm cache 107.79 MiB |
| RAM | 908 MiB total, ~385 MiB available; no swap |
| Previously verified endpoints | Apex and www HTTPS 200; protected profile API 401 without login; polling handshake valid; WebSocket upgrade 101 |

Disk is sufficient for the proposed sequential preparation: a small static backup, one backend candidate dependency tree, checkout copies and one frontend artifact. Reserve **1 GiB for preparation plus 1 GiB free headroom**; check again before and after installation because dependency sizes can change. Do not delete existing assets/caches/backups to force a failed space check through. Avoid a Vite build on this small EC2 machine while serving users: build the static frontend locally and transfer only `dist`. Native backend dependencies must be installed on Ubuntu in the candidate directory. Install/test sequentially and monitor memory; if preparation affects the live app, stop preparation, not PM2.

### Configuration and data preservation

Verified locally: `CLIENT_ORIGINS=https://devtinder.work,https://www.devtinder.work` is parsed into the two exact origins by `src/config/origins.js`. `app.js` loads dotenv before configuring HTTP CORS and Socket.IO, and both use that same function. Current PM2 environment inspection showed none of CLIENT_ORIGINS, JWT_SECRET, MONGO_URI, Razorpay keys or TURN secrets injected independently of `.env`. Recheck if the PM2 configuration changes.

Preparation copies `.env` to a private candidate file and changes **only CLIENT_ORIGINS**. The commands compare all other parsed settings without printing values. MongoDB URI, JWT secret, Razorpay credentials/webhook secret, email settings and PORT remain identical. No application process is started against production during preparation, avoiding duplicate cron jobs, email delivery and database connections. Tests use fake data. No migration, collection deletion or database reset exists in this release. Payment routes/model/client, database configuration and connection/chat schemas are unchanged between the deployed backend commit and candidate; JWT signing now correctly reads the existing JWT_SECRET. Existing sessions may require login again if the prior hardcoded signing secret differed; do not rotate the secret merely to deploy this feature.

The application still has legacy webhook validation/logging and password-update issues described below. Preserving payment configuration is not equivalent to proving every payment path correct. Test payment integration in test mode without changing live credentials.

## Stage 1 — safe backup and preparation (approval required)

This stage may create private release/backup files, fetch source, install candidate dependencies, and upload assets. It must not edit active `.env`, change either active checkout, modify `/var/www/html`, start a second backend, stop PM2, or change Nginx. Approval for this stage does **not** approve activation.

The commands below pin the approved security commits, not a moving branch. The backend main branch also contains the later documentation-only commit recording these hashes. Verify the frontend release is the expected remote main and the backend release remains an ancestor of remote main. Build from a new local checkout so the separate uncommitted DaisyUI manifest edit in `E:\devTinder-web` is preserved and excluded. The fixed local/server preparation directories intentionally fail if already present: inspect an existing attempt instead of overwriting its backups.

### 1A. Build a verified frontend artifact on Windows

```powershell
cd E:\devTinder
$frontendRelease = 'f87312e779202cd2ebfc18d0ba6a50f76b2226ae'
$frontendSource = 'E:\devTinder\.video-work\frontend-f87312e7'
if (Test-Path -LiteralPath $frontendSource) { throw 'Preparation directory already exists; inspect it first' }
git clone --no-checkout https://github.com/Sanket01-debug/devTinder-web.git $frontendSource
if ($LASTEXITCODE -ne 0) { throw 'Clone failed' }
Set-Location -LiteralPath $frontendSource
git checkout --detach $frontendRelease
if ($LASTEXITCODE -ne 0) { throw 'Checkout failed' }
if ((git rev-parse origin/main).Trim() -ne $frontendRelease) { throw 'Remote frontend main changed; review required' }
if ($frontendRelease -cnotmatch '^[0-9a-f]{40}$') { throw 'Reviewed fixed release hash required' }
if ((git rev-parse HEAD).Trim() -ne $frontendRelease) { throw 'Release hash mismatch' }
if (git status --porcelain) { throw 'Frontend has uncommitted changes' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint failed' }
npm audit
if ($LASTEXITCODE -ne 0) { throw 'Resolve/review build-tool vulnerabilities before building' }
npm audit --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'Resolve/review the audit before preparing the release' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$artifact = 'E:\devTinder\.video-work\frontend-release.tgz'
tar -czf $artifact -C "$frontendSource\dist" .
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
$digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash.ToLower()
Set-Content -Encoding ascii 'E:\devTinder\.video-work\frontend-release.sha256' "$digest  frontend-release.tgz"
Set-Content -Encoding ascii 'E:\devTinder\.video-work\frontend-release.commit' $frontendRelease
```

### 1B. Create backups and persistent release state on Ubuntu

Connect only after Stage 1 approval:

```powershell
ssh -i 'C:\Users\sanke\Downloads\devTinder-secret.pem' ubuntu@15.206.165.64
```

Then run on Ubuntu:

```bash
set -euo pipefail
source /home/ubuntu/.nvm/nvm.sh
nvm use 22.20.0
umask 077
BACKEND=/home/ubuntu/devTinder
FRONTEND=/home/ubuntu/devTinder-web
STATIC=/var/www/html
STATE=/home/ubuntu/devtinder-deployment
BACKEND_RELEASE=e3ab9836ea7fb62af439793c1f7a9ae87746a4fe
FRONTEND_RELEASE=f87312e779202cd2ebfc18d0ba6a50f76b2226ae
[[ "$BACKEND_RELEASE" =~ ^[0-9a-f]{40}$ ]]
[[ "$FRONTEND_RELEASE" =~ ^[0-9a-f]{40}$ ]]
test -z "$(git -C "$BACKEND" status --porcelain)"
test -z "$(git -C "$FRONTEND" status --porcelain)"
command -v rsync
test "$(df -B1 --output=avail /home/ubuntu | tail -1)" -ge 2147483648
sudo nginx -t
mkdir -p -m 700 "$STATE"
RELEASE="$STATE/release-e3ab9836-f87312e7"
test ! -e "$RELEASE"
mkdir -m 700 "$RELEASE"
declare -p BACKEND FRONTEND STATIC STATE RELEASE BACKEND_RELEASE FRONTEND_RELEASE > "$RELEASE/state.sh"
git -C "$BACKEND" rev-parse HEAD > "$RELEASE/backend-before.sha"
git -C "$FRONTEND" rev-parse HEAD > "$RELEASE/frontend-before.sha"
cp -p "$BACKEND/.env" "$RELEASE/backend-before.env"
chmod 600 "$RELEASE/backend-before.env"
sudo cp -a "$STATIC" "$RELEASE/static-before"
printf '%s\n' "$RELEASE" > "$STATE/current.new"
mv "$STATE/current.new" "$STATE/current"
# Also keep this path in your private deployment notes. It survives disconnection.
printf 'Persistent release/backup path: %s\n' "$RELEASE"
git clone --no-checkout https://github.com/Sanket01-debug/devTinder.git "$RELEASE/backend"
git -C "$RELEASE/backend" merge-base --is-ancestor "$BACKEND_RELEASE" origin/main
git -C "$RELEASE/backend" checkout --detach "$BACKEND_RELEASE"
test "$(git -C "$RELEASE/backend" rev-parse HEAD)" = "$BACKEND_RELEASE"
cd "$RELEASE/backend"
npm ci --include=dev
npm test
npm audit
npm audit --omit=dev
# Both local trees audited clean on 2026-11-24. Abort on new findings;
# do not upgrade or audit-fix the candidate on EC2.
npm prune --omit=dev
npm ls --omit=dev
cp "$RELEASE/backend-before.env" "$RELEASE/backend/.env"
printf '\nCLIENT_ORIGINS=https://devtinder.work,https://www.devtinder.work\n' >> "$RELEASE/backend/.env"
chmod 600 "$RELEASE/backend/.env"
node - "$RELEASE/backend-before.env" "$RELEASE/backend/.env" <<'JS'
const fs=require('fs'),assert=require('node:assert/strict'),dotenv=require('dotenv');
const [oldFile,newFile]=process.argv.slice(2);
const old=dotenv.parse(fs.readFileSync(oldFile)), next=dotenv.parse(fs.readFileSync(newFile));
for(const key of new Set([...Object.keys(old),...Object.keys(next)])) {
  if(key !== 'CLIENT_ORIGINS' && old[key] !== next[key]) throw new Error('Unexpected environment change');
}
process.env.CLIENT_ORIGINS=next.CLIENT_ORIGINS;
assert.deepEqual(require('./src/config/origins')(),['https://devtinder.work','https://www.devtinder.work']);
console.log('Origin override valid; all other environment settings unchanged.');
JS
git -C "$BACKEND" fetch origin
git -C "$FRONTEND" fetch origin
test "$(git -C "$FRONTEND" rev-parse origin/main)" = "$FRONTEND_RELEASE"
git -C "$BACKEND" merge-base --is-ancestor HEAD "$BACKEND_RELEASE"
git -C "$FRONTEND" merge-base --is-ancestor HEAD "$FRONTEND_RELEASE"
test "$(df -B1 --output=avail /home/ubuntu | tail -1)" -ge 1073741824
touch "$RELEASE/backend-prepared"
```

From a separate Windows terminal, upload the three artifacts to the exact release directory created above:

```powershell
scp -i 'C:\Users\sanke\Downloads\devTinder-secret.pem' E:\devTinder\.video-work\frontend-release.tgz E:\devTinder\.video-work\frontend-release.sha256 E:\devTinder\.video-work\frontend-release.commit ubuntu@15.206.165.64:/home/ubuntu/devtinder-deployment/release-e3ab9836-f87312e7/
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }
```

Finish preparation, including after a new SSH session:

```bash
set -euo pipefail
RELEASE=$(cat /home/ubuntu/devtinder-deployment/current)
test "$RELEASE" = /home/ubuntu/devtinder-deployment/release-e3ab9836-f87312e7
source "$RELEASE/state.sh"
cd "$RELEASE"
test -f backend-prepared
test "$(tr -d '\r\n' < frontend-release.commit)" = "$FRONTEND_RELEASE"
sha256sum -c frontend-release.sha256
mkdir frontend-dist
tar -xzf frontend-release.tgz -C frontend-dist
test -f frontend-dist/index.html
test "$(df -B1 --output=avail /home/ubuntu | tail -1)" -ge 1073741824
touch READY
printf 'Prepared; awaiting separate Stage 2 approval: %s\n' "$RELEASE"
```

Only the artifact built above from a clean, audited checkout may be extracted. No secrets or server dependencies belong in that archive. Report actual audit/test results, prepared hashes, remaining disk, and the persistent backup path to the user. **Stop here and obtain explicit Stage 2 approval.** Do not create approval markers on the user's behalf or combine these stages in an automatically continuing script.

## Stage 2 — production activation (separate explicit approval required)

Reconfirm the approved release path and hashes. All installations, tests and builds have already completed. Downtime covers only checkout/dependency switches and the single PM2 restart; it is not zero downtime, and active calls/chat connections will disconnect. Do not use PM2 cluster mode or run a duplicate cron-enabled application.

```bash
set -euo pipefail
source /home/ubuntu/.nvm/nvm.sh
nvm use 22.20.0
RELEASE=$(cat /home/ubuntu/devtinder-deployment/current)
source "$RELEASE/state.sh"
test -f "$RELEASE/READY"
test ! -e "$RELEASE/previous-node_modules"
test "$(git -C "$BACKEND" rev-parse HEAD)" = "$(cat "$RELEASE/backend-before.sha")"
test "$(git -C "$FRONTEND" rev-parse HEAD)" = "$(cat "$RELEASE/frontend-before.sha")"
test -z "$(git -C "$BACKEND" status --porcelain)"
test -z "$(git -C "$FRONTEND" status --porcelain)"
cmp -s "$BACKEND/.env" "$RELEASE/backend-before.env"
test "$(git -C "$RELEASE/backend" rev-parse HEAD)" = "$BACKEND_RELEASE"
cd "$RELEASE"
sha256sum -c frontend-release.sha256
# Abort if files/settings changed since backup; refresh preparation and review.
pm2 stop devtinder-backend
mv "$BACKEND/node_modules" "$RELEASE/previous-node_modules"
mv "$RELEASE/backend/node_modules" "$BACKEND/node_modules"
git -C "$BACKEND" merge --ff-only "$BACKEND_RELEASE"
install -m 600 "$RELEASE/backend/.env" "$BACKEND/.env.next"
mv "$BACKEND/.env.next" "$BACKEND/.env"
pm2 restart devtinder-backend --update-env
# Poll for up to 30 seconds; expected protected endpoint response is 401.
healthy=false
for attempt in $(seq 1 15); do
  code=$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' http://localhost:7777/profile/view || true)
  if [ "$code" = 401 ]; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
# Only publish the new frontend after the backend passes its health probe.
sudo rsync -a --exclude=index.html --chown=root:root --chmod=D755,F644 "$RELEASE/frontend-dist/" "$STATIC/"
sudo install -o root -g root -m 644 "$RELEASE/frontend-dist/index.html" "$STATIC/.index.html.next"
sudo mv "$STATIC/.index.html.next" "$STATIC/index.html"
git -C "$FRONTEND" merge --ff-only "$FRONTEND_RELEASE"
pm2 status devtinder-backend
curl -fsS https://devtinder.work/ > /dev/null
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://devtinder.work/api/video/ice)" = 401
touch "$RELEASE/ACTIVATED"
# Run the functional checks below before declaring success, then:
pm2 save
```

If any command fails after `pm2 stop`, do not rerun activation blindly; use rollback immediately. Old dependencies remain ready on the same filesystem, so rollback needs no npm install or network access. Do not delete the previous dependencies, static snapshot or private environment backup until the new release is accepted. Review PM2 logs locally, not in shared output: legacy logs can contain sensitive data.

### Self-contained rollback, including a new SSH session

```bash
set -euo pipefail
source /home/ubuntu/.nvm/nvm.sh
nvm use 22.20.0
RELEASE=$(cat /home/ubuntu/devtinder-deployment/current)
source "$RELEASE/state.sh"
test -f "$RELEASE/backend-before.env"
test -f "$RELEASE/static-before/index.html"
pm2 stop devtinder-backend
git -C "$BACKEND" switch --detach "$(cat "$RELEASE/backend-before.sha")"
git -C "$FRONTEND" switch --detach "$(cat "$RELEASE/frontend-before.sha")"
if [ -d "$RELEASE/previous-node_modules" ]; then
  if [ -d "$BACKEND/node_modules" ]; then
    mv "$BACKEND/node_modules" "$RELEASE/failed-node_modules-$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  mv "$RELEASE/previous-node_modules" "$BACKEND/node_modules"
fi
install -m 600 "$RELEASE/backend-before.env" "$BACKEND/.env.next"
mv "$BACKEND/.env.next" "$BACKEND/.env"
pm2 restart devtinder-backend --update-env
sudo rsync -a --exclude=index.html "$RELEASE/static-before/" "$STATIC/"
sudo install -o root -g root -m 644 "$RELEASE/static-before/index.html" "$STATIC/.index.html.next"
sudo mv "$STATIC/.index.html.next" "$STATIC/index.html"
pm2 status devtinder-backend
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://devtinder.work/api/profile/view
curl -fsS https://devtinder.work/ > /dev/null
pm2 save
```

The expected profile response is 401. Record the rollback outcome and confirm login/chat. Extra content-hashed assets are retained intentionally; old index.html references the restored assets. No database rollback is needed because the release has no migrations. Do not force checkout if unexpected tracked edits appeared. The `current` pointer is for the latest prepared release; verify the printed release identifier before rollback if another deployment was prepared later, or source that older release's `state.sh` explicitly.

## Initial testing without TURN, then managed TURN later

**Yes: the backend can start and calls can be tested without TURN.** Verified locally: with TURN variables absent, `/video/ice` configuration uses public STUN and `iceTransportPolicy: all`. Authentication, chat, payment and call signaling do not depend on TURN. Same-network and some cross-network calls work, but symmetric NAT, carrier-grade NAT and corporate firewalls can prevent media even when signaling succeeds. Expect a connection error/timeout in those cases. Do not use `relay` with no TURN server or advertise universal connectivity.

For later managed relay, use a service explicitly supporting coturn TURN REST shared-secret authentication: `username = expiryUnix:userId`, `password = Base64(HMAC-SHA1(secret, username))`, with 24-hour credentials. [ExpressTURN's documented secret-key mode](https://www.expressturn.com/webrtc-secret-key-examples) implements this scheme; [coturn documents the protocol](https://github.com/coturn/coturn/wiki/turnserver). A provider's static TURN password or HTTP API key is not interchangeable with its TURN auth secret. ExpressTURN recommends its dashboard username in the suffix for attribution; DevTinder currently uses the user ID. Confirm your selected account permits this suffix and 24-hour TTL before purchase/use; otherwise a reviewed provider integration is needed. No provider account or allocation has been tested here.

Separate, later TURN configuration steps (require approval for the environment change/restart):

1. Obtain a secret-key-enabled managed endpoint and its exact UDP/TCP/TLS URLs and auth secret from the provider dashboard. Confirm protocol, suffix and TTL compatibility, bandwidth quota and TLS on a provider-supported port. Do not change DevTinder DNS or self-host coturn on EC2 for this plan.
2. SSH in and back up the current environment privately. Use the following commands, entering real values only in the editor:

```bash
set -euo pipefail
source /home/ubuntu/.nvm/nvm.sh
nvm use 22.20.0
umask 077
TURN_BACKUP="/home/ubuntu/devtinder-deployment/turn-$(date -u +%Y%m%dT%H%M%SZ).env"
cp /home/ubuntu/devTinder/.env "$TURN_BACKUP"
printf '%s\n' "$TURN_BACKUP" > /home/ubuntu/devtinder-deployment/turn-backup.current
nano /home/ubuntu/devTinder/.env
# Add the dashboard-provided URLs and auth secret:
# TURN_URLS=turn:PROVIDER_HOST:PROVIDER_PORT?transport=udp,turn:PROVIDER_HOST:PROVIDER_PORT?transport=tcp,turns:PROVIDER_TLS_HOST:PROVIDER_TLS_PORT?transport=tcp
# TURN_SHARED_SECRET=<provider TURN auth secret, not an HTTP API key>
# ICE_TRANSPORT_POLICY=relay
# Keep all other settings unchanged. Do not print the resulting .env.
pm2 restart devtinder-backend --update-env
```

3. Start a new call between Wi-Fi and cellular devices. Verify two-way moving video and audible audio. In `chrome://webrtc-internals`, confirm the selected candidate pair contains a `relay` candidate. Never share the ICE endpoint response—it contains temporary credentials. A successful signaling handshake alone is not proof of TURN.
4. Restore `ICE_TRANSPORT_POLICY=all` with `nano /home/ubuntu/devTinder/.env`, restart `devtinder-backend --update-env`, and verify a fresh call again. PM2 must not independently override TURN values; recheck before this change. No frontend rebuild or Nginx/security-group change is needed for managed TURN.
5. If relay testing fails, restore the private backup and restart:

```bash
source /home/ubuntu/.nvm/nvm.sh
nvm use 22.20.0
TURN_BACKUP=$(cat /home/ubuntu/devtinder-deployment/turn-backup.current)
install -m 600 "$TURN_BACKUP" /home/ubuntu/devTinder/.env
pm2 restart devtinder-backend --update-env
```

After activation, verify fresh login/signup, profile/feed, request accept/reject, saved two-user chat, Premium display and test-mode payment flow, incoming call away from chat, accept/decline/end, media cleanup, browser console, and both apex/www origins. Initial no-TURN testing does not count as separate-network relay verification. No authenticated production workflow or real charge was exercised during this audit.

---

No production deployment or infrastructure changes have been performed.

Video calls are **unlimited for all signed-in users with accepted connections**, including free accounts. There are no daily or membership-based call quotas, usage counters, or quota collections. Silver and Gold retain their existing prices and payment behavior. The Premium UI now makes free calling explicit, with refreshed cards displaying the existing Silver ₹300 / 3 months and Gold ₹700 / 6 months prices. Keep these display prices aligned with `src/utils/constants.js`; checkout remains authoritative.

## Design and scope

The existing JWT `token` cookie now authenticates Socket.IO connections. The server derives identity and profile details from that cookie, checks the existing `ConnectionRequest` model for `accepted` in either direction, and assigns opaque call IDs itself. Chat event names and message shapes remain compatible; client-supplied names/user IDs no longer grant access. HTTP chat history also requires an accepted connection. JWT signing now uses the same `JWT_SECRET` as verification (the previous signer used a hardcoded key). No database schema or connection-request behavior changes are required.

One shared frontend socket lives under `Body`, survives route changes, and disconnects on logout/unmount. Incoming calls appear throughout the signed-in app. A native modal dialog provides keyboard focus containment, mobile layout, caller details, accept/decline, local/remote video, mute/camera controls, timer, status and errors. Capture begins after acceptance (the recipient first grants device permissions); no capture occurs for a declined incoming call. Permission requests cannot be aborted by browsers, so late streams are immediately stopped after cancellation.

Routine call notices (ended, declined, unanswered, answered elsewhere) dismiss automatically after one second; error notices remain for eight seconds. The close button dismisses either immediately. Starting a new call or replacing a notice cancels the previous notice timer.

Socket.IO carries invitation, SDP offer/answer and ICE candidates only. `RTCPeerConnection` transports audio/video directly between browsers, or via TURN when a direct path is unavailable. Media is not sent through Express, MongoDB, Nginx or Cloudflare. ICE candidates arriving before the remote description are buffered. Ending/unmounting closes the peer, stops tracks, clears timers and removes listeners.

The backend reserves both users atomically after asynchronous connection authorization. Calls ring for 30 seconds, have 45 seconds to establish media after acceptance, and a four-hour maximum duration. Both peers report connection success. A 12-second browser grace period handles temporary media disconnection; socket disconnection ends the call immediately. Expired JWTs disconnect the socket. Multiple tabs can receive an invitation; the first successful acceptance owns the call and other tabs dismiss it. Signaling is restricted to the initiating and accepting sockets, with direction/phase/payload validation and bounded ICE candidate counts.

**Deployment requirement:** the in-memory registry requires **one Node process / one PM2 instance**, matching the inspected `devtinder-backend` process. Restarting it ends active calls. Multiple instances would require shared atomic call state, presence and a Socket.IO adapter; do not enable cluster mode with this implementation. Incoming notifications require an open, connected app tab; there is no push service or background mobile calling.

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

Optional dependency compatibility smoke test, executed locally on 2026-11-24:

```powershell
cd E:\devTinder
npm install --prefix .video-work/mongo --no-save --package-lock=false --ignore-scripts mongodb-memory-server@11.4.0
if ($LASTEXITCODE -ne 0) { throw 'Test tooling installation failed' }
$env:MONGOMS_MODULE = 'E:\devTinder\.video-work\mongo\node_modules\mongodb-memory-server'
$env:MONGOMS_DOWNLOAD_DIR = 'E:\devTinder\.video-work\mongo-binaries'
node test-support/dependency-smoke.cjs
if ($LASTEXITCODE -ne 0) { throw 'Dependency smoke test failed' }
```

This installs optional tooling only under ignored `.video-work`, not in either application manifest/lockfile. The first run downloads a MongoDB binary (tested with 8.2.6). The harness creates a temporary loopback database with fake users, uses actual application models/auth/chat routes and Socket.IO handlers, and stops that database afterward. It never loads `.env` or connects to Atlas. Razorpay requests go to a local fake HTTP endpoint with fake keys; the actual SDK handles an order request, 307 redirect and valid/invalid webhook signatures. This is a compatibility test, not a Razorpay sandbox checkout or a full payment-route acceptance test. Do not run this optional harness on the memory-constrained production host.

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

The frontend README documents `/var/www/html` static assets, `/etc/nginx/sites-available/default`, backend port 7777, and PM2 process `devtinder-backend`. Its proxy block is:

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

Existing EC2 inbound HTTPS rules suffice with managed TURN: the browsers exchange media directly or connect to the TURN provider; EC2 does not relay it. No new inbound UDP range or public port 7777 is needed. Actual AWS security-group rules were not accessible here. Self-hosting TURN would change that assessment and is outside this runbook. Keep domain, GoDaddy nameservers, Cloudflare DNS and current TLS setup unchanged. Browser camera/mic require a secure context; valid HTTPS at `https://devtinder.work` supports this, subject to user permissions and browser policy. TLS/proxy/PM2 were inspected read-only on 2026-11-23 as summarized above; no new production inspection or mutation was made during dependency remediation.

References: [Socket.IO proxy requirements](https://socket.io/docs/v4/reverse-proxy/), [browser capture security](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection), [PM2 process management](https://pm2.keymetrics.io/docs/usage/process-management/).

## Validation results and remaining limits

Fresh checks on 2026-11-24 with Node 22.20.0 / npm 11.9.0, after all dependency updates:

| Check | Actual result |
| --- | --- |
| Backend `npm test` | **21 passed, 0 failed**; real local Socket.IO/HTTP transports and JWTs, stubbed database, including repeated accepted calls between free accounts |
| Frontend `npm test` | **8 passed, 0 failed**; injected media/peer lifecycle APIs |
| Frontend `npm run lint` | **Passed**, no lint errors |
| Frontend `npm run build` | **Passed**, Vite production build |
| Clean `npm ci`, both repositories | **Passed** with the updated lockfiles |
| Full `npm audit`, both repositories | **0 vulnerabilities**, including development dependencies |
| `npm audit --omit=dev`, both repositories | **0 production vulnerabilities** |
| Backend lint / build | No lint or build scripts are defined; all backend source/test JavaScript passed `node --check` |
| `node test-support/dependency-smoke.cjs` | **Passed** against real temporary MongoDB 8.2.6: create/update/query/populate, connection validation, JWT login/cookies, bcrypt, persisted Socket.IO chat/history, WebRTC signaling, gzip JSON/malformed-body survival, Razorpay SDK order/307 redirect and webhook signatures |
| `node test-support/browser-smoke.cjs` | **Passed**, two separate Chrome processes with deterministic simulated cameras, real WebRTC, received moving video/live audio tracks, incoming notification outside chat, mute/camera controls, hangup cleanup, decline, chat before/after; no browser runtime errors; redesigned Premium cards also inspected |
| Visual inspection | Earlier desktop 1365×900 and mobile 390×844 inspection passed; the fresh browser smoke reran desktop/mobile UI assertions and captured screenshots |
| Git whitespace checks | Passed in both repositories |

Initial test execution was blocked by Windows sandbox `spawn EPERM`; it passed when run with approved subprocess permissions. A later browser check found the development backend already using port 7777; the harness was changed to an automatically assigned isolated port without stopping the running app. The initial offline test-dependency installation failed with `ENOTCACHED`; the approved online installation succeeded. Two early browser smoke attempts timed out with the host's default fake camera (first missing device, then connected peers but no remote frames). The harness now uses separate Chrome processes and an explicit generated Y4M camera file; the final run passed. These failures and the test-only harness changes are not evidence of physical-camera or cross-network validation.

The earlier backend 5 findings and frontend 17 full-tree findings are now resolved locally. Fresh online audit JSON reports are saved under ignored `.video-work/{backend,frontend}-{audit,production}-after.json`. No audit finding was suppressed. The initial optional MongoDB binary download stalled during the earlier session; the completed cached binary was used successfully for the fresh compatibility test. These results do not change the still-running production dependencies.

Real separate-network devices, actual TURN provider credentials, Atlas persistence, production AWS/PM2/Nginx settings and real payment flows still require the manual acceptance steps. Audio tracks were checked programmatically; audible quality needs the two-device test. Existing unrelated authentication response/logging, password-edit and payment hardening issues listed in the README remain outside this change. Production configuration was inspected without printing secret values; no production environment file was modified, no secrets were committed, and nothing was deployed.
