# Powerball

A prediction market for the Power pickleball tournament. Everyone who joins gets 100 credits to bet on which team wins. Prices move with demand, like Polymarket (an LMSR market maker). The page also shows a record bracket, the full 11-round schedule, a leaderboard and an activity feed.

## How it's built

- `public/` is the website: `index.html`, `style.css`, `app.js`, and `shared.js` (teams, schedule and market math, shared with the server).
- `api/` holds Vercel serverless functions: `state`, `join`, `trade`, `admin`.
- Data lives in **Upstash Redis**, connected through the Vercel Marketplace (free tier).
- Every bet is priced on the server while a lock is held, so two people can't buy at the same stale price, and nobody can edit their own balance.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Locally, data is kept in memory and the organizer password is `admin`.

## Put it on GitHub

1. Create an empty repo at https://github.com/new named `powerball`. Leave "Add a README" unchecked.
2. From this folder:

```bash
git init
git add .
git commit -m "Powerball tournament market"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/powerball.git
git push -u origin main
```

If you have the GitHub CLI (`gh`), this single command replaces both steps above: `gh repo create powerball --private --source=. --push`

## Deploy on Vercel

1. Go to https://vercel.com/new, sign in with GitHub, and **Import** the `powerball` repo.
2. Framework preset: **Other**. Leave the build and output settings empty, then click **Deploy**.
3. **Add the database.** In the project, open **Storage** → **Create Database** → **Upstash for Redis** (Marketplace) → free plan → connect it to this project for all environments. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
4. **Add settings.** Under **Settings → Environment Variables**, add:
   - `ADMIN_KEY`: your organizer password
   - `SESSION_SECRET`: any long random string (run `openssl rand -hex 32` to make one)
   - `EVENT_CODE` (optional): if set, people need this code to join
5. **Redeploy** under **Deployments** → ⋯ → **Redeploy**, so the new settings take effect.
6. Open your `*.vercel.app` URL. If the yellow "Database not connected" banner shows, step 3 or 5 didn't take.

After that, every `git push` to `main` redeploys automatically.

## On tournament day

- Share the link. People type their name to join. Typing the same name on another device signs them back in as that person. There's no password, so this is an honour system.
- Open the **Organizer desk** at the bottom of the page and unlock it with `ADMIN_KEY`.
- After each match, tap **Score** next to it in the schedule. Enter both scores, or just pick the winner.
- **Pause trading** before the last round if you don't want late bets.
- **Settle market** crowns the champion. It defaults to the standings leader (most wins, then point difference, then points scored), and you can pick another team if a playoff decides it. **Undo settlement** reverses it.

## Changing teams or the schedule

Edit `TEAMS` and `SCHEDULE` in `public/shared.js`, then commit and push.

## Starting over

In the Upstash console for the database, delete the keys starting with `pb:`, or run `FLUSHDB` if nothing else uses that database.
