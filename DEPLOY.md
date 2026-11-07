# Deploy on Render (free)

Web service, Node runtime, free plan. The blueprint in `render.yaml` sets this. Do not use a static site: the app is a Node HTTP server plus the files in `public/`.

There is no compile step. Dependencies: none.

| Setting | Value |
| --- | --- |
| Build command | `npm install` |
| Start command | `node server.js` |
| Health check | `GET /api/session` (returns 200) |
| Node | 22 (`NODE_VERSION=22` in the blueprint, and `engines.node` is `>=22.0.0 <23`) |

The process listens on `process.env.PORT` and `0.0.0.0`. Render's default port is 10000. Do not set `PORT` yourself.

## Environment variables

Set these in the Render dashboard when the blueprint asks. Do not paste values into the repo.

| Name | Required | |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | Yes, on Render | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes, on Render | Upstash Redis REST token |
| `NODE_VERSION` | Set by the blueprint | `22` |
| `PORT` | Set by Render | Bind address port |
| `HOST` | No | Defaults to `0.0.0.0` |
| `DATA_DIR` | No | Local JSON file directory. Ignored when both Upstash variables are set. Do not rely on it on Render. |

Create a free Redis database at [Upstash](https://upstash.com) and copy its **REST URL** and **REST token** (not the `rediss://` URL). The app stores the whole workshop as one JSON value under the key `family-santa:db`, via Upstash's REST API. No extra npm package.

If either Upstash variable is missing or the token is rejected, the process exits on startup and names the variable in the log. It does not fall back to a file in that case. With both unset, and only when `RENDER` is not `true`, it writes `family-santa.json` under `DATA_DIR` (default `./data`) so local development still works.

Do not point this app at Render's free Key Value. That service keeps data in memory and drops it on restart, which is the same failure as the local disk.

## Free-tier caveats

- The service sleeps after 15 minutes without a request. The next visit takes about a minute while Render shows its loading page. A signed-in tab polls every 15 seconds and keeps the instance awake, which spends the workspace's 750 free instance hours.
- The disk is wiped on restart, redeploy, and spin-down. Wishes, PINs, and sessions live in Upstash, or they are gone.
- One instance only (0.1 CPU, 512 MB). The store is a single key with last-write-wins. Do not scale it out.
- Render may restart a free web service at any time. Login lockouts (5 misses, then 5 minutes) are kept in memory and reset when that happens. The wish list does not.
- Free instance hours, outbound bandwidth, and build minutes are capped per workspace per month. Past the hour cap, Render suspends free web services until next month.
- Outbound SMTP ports are blocked. This app does not send mail.
- The browser loads fonts from `fonts.googleapis.com` and `fonts.gstatic.com`. Gift links are not fetched by the server.
- Use the `https://` onrender.com URL. Session cookies are marked `Secure` when the request is HTTPS.
