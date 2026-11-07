# Family Santa

**The family Christmas wish list that keeps a secret.**

Everyone posts their Christmas list. Everyone else quietly *calls dibs* on what they're buying, so nobody ends up giving Mom the same dutch oven twice. You can see what's taken on every list **except your own**.

## How it works

1. **Start a family.** Pick a family name, your name, an ornament color and a PIN. You get a family code like `JINGLE-4821`.
2. **Share the code** (or the invite link) in the family group chat. Each person joins with their own name and PIN.
3. **Write your list.** Add links, rough prices, sizes and notes, and mark how badly you want each thing.
4. **Call dibs.** Open someone's list and stamp the gift you're getting. Everyone else sees it's taken. A couple of extras:
   - **Chip in:** split a gift with whoever already called it.
   - **Off-list surprises:** buying something that isn't on their list? Log it so nobody else buys the same thing.
   - **My sleigh:** your private shopping list. Track each gift through *Dibs → Bought → Wrapped*, and see what your share costs.
5. **Stay surprised.** On your own list, the **spoiler shield** is always on.

### The spoiler shield (the important part)

Hiding gifts from the person they're for is enforced **by the server**, not just hidden on screen. When you load your own list, the response has no claims, no surprises and no statuses. Even someone reading the raw network traffic sees nothing. The same goes for the activity feed ("Workshop gossip"), your sleigh, and the counts on the home screen. Gift IDs about you answer *not found*, so they can't be probed either.

A few details that keep it honest:

- If you delete a wish someone already called dibs on, you get exactly the same response as for an unclaimed wish. The giver keeps it in their sleigh with a heads-up that it came off your list.
- If you edit a wish after someone called dibs, they get a "double-check the details" note.
- The test suite (`test/privacy.test.js`) checks every one of these rules.

### People who don't log in

Little kids, grandparents, the dog: on the **Family** page, add someone "who won't log in". Anyone in the family can edit their list, and everyone can see what's been claimed for them.

### Organizers

Whoever starts the family is an organizer. Organizers can rename the family, reset a forgotten PIN (that person picks a new one the next time they sign in), remove people, and make other people organizers.

## Running it

You need [Node.js](https://nodejs.org) 22 (any 22.x). There are **no dependencies** to install. Deploying on Render's free plan is covered in [DEPLOY.md](DEPLOY.md).

```bash
npm start          # http://localhost:3000
npm test           # privacy + storage tests
```

| Setting | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Where `family-santa.json` is saved |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | – | Store data in Upstash Redis instead of a file (for hosts without a permanent disk) |

All of a family's data is a single small JSON document, so a big family with long lists is still only a few hundred KB.

## Putting it online for the family

The family needs one shared copy running somewhere. Pick one:

**Free: Render + Upstash**
1. Create a free Redis database at [upstash.com](https://upstash.com) and copy its **REST URL** and **REST token**.
2. On [render.com](https://render.com), choose **New → Blueprint**, point it at this repo (it reads `render.yaml`) and paste the two Upstash values when asked.
3. Share your `https://family-santa-xxxx.onrender.com` link. Free Render apps nap when idle, so the first visit after a quiet spell takes about 30 seconds to wake up.

**Any host with a disk (Railway, Fly.io, a VPS, a home server)**
```bash
docker build -t family-santa .
docker run -d -p 3000:3000 -v family-santa-data:/data family-santa
```
Keep `/data` on a persistent volume.

Use HTTPS when it's on the internet (Render, Railway and Fly provide it). Sign-in cookies are marked `Secure` automatically behind HTTPS.

## Under the hood

- `server.js`: starts the HTTP server
- `lib/app.js`: the JSON API, the privacy rules (look for `visibleTo`) and static file serving
- `lib/store.js`: saves to a JSON file, Upstash Redis or memory (for tests)
- `lib/auth.js`: PIN hashing (scrypt), session tokens and family codes
- `public/`: the website itself, in plain HTML, CSS and JavaScript with no build step

Security is family-grade: PINs are hashed, sign-ins lock for 5 minutes after 5 wrong guesses, sessions are HttpOnly cookies, and pages ship a strict Content-Security-Policy. It's built to keep your brother from peeking, not to guard state secrets.
