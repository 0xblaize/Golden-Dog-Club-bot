# Golden Dog Club Telegram Points Bot

A serverless Telegram community game built around an internal points economy. Players collect points, battle other players, answer quizzes, complete daily reactions, climb tiers, and invite friends.

This project does **not** connect to wallets, cryptocurrencies, payment providers, or external money systems. All points remain inside the bot database.

## Features

- Internal balances: Game Balance, Spot Balance, and Total Points
- Timed `/collect` claims with tier-based cooldowns
- Progression tiers: Starter, Rising, Elite, and Legend
- Tier-based battle limits and faster collection cooldowns
- Random same-tier battles
- Targeted battles with `/battle @username amount`
- Group battle announcements and private Telegram challenge notifications
- Accept buttons for battles
- Battle strength based on previous wins
- Automatic expiry of unanswered battles after one hour
- Public collector and battler leaderboards
- Referral links with anti-farming qualification
- Referral payout after the invited player completes three collects
- Daily reaction reward with a 1x–3x multiplier
- 100 seeded quiz questions:
  - 25 Web3 questions
  - 25 Web2 and internet questions
  - 25 calculation questions
  - 25 jokes and fun-trivia questions
- Quiz categories and difficulty labels
- Maximum five quiz attempts per user per UTC day
- One answer per user per quiz question
- Working inline buttons for all major actions
- `/commands` command menu with emojis
- Telegram command autocomplete registration
- Activity rate limiting and scheduled cleanup

## Technology

- TypeScript
- grammY
- Cloudflare Workers
- Cloudflare D1
- Drizzle ORM schema definitions
- Cloudflare KV binding reserved for short-lived state
- Vitest

## Requirements

Install the following before starting:

- Node.js 20 or newer
- npm
- A Cloudflare account with Workers and D1 access
- A Telegram bot token from BotFather

## Project structure

```text
src/
  index.ts                 Cloudflare Worker entrypoint
  bot.ts                   grammY commands, buttons, and callbacks
  env.ts                   Cloudflare binding types
  db/schema.ts             Drizzle database schema
  services/
    activity.ts            Rate limiting and scheduled cleanup
    admin.ts               Admin-only operations
    battles.ts             Battle creation, matching, resolution, rankings
    games.ts               Quiz and reaction logic
    points.ts              Users, balances, tiers, claims, referrals
    rules.ts               Pure game rules and formatting helpers

drizzle/
  0000_initial.sql         Initial database schema and tier seeds
  0001_game_integrity.sql  Quiz and battle integrity indexes
  0002_open_battles.sql    Open battles, group chat IDs, cooldown updates
  0003_quiz_pack.sql       100-question quiz content
  0004_quiz_metadata_repair.sql  Quiz metadata correction migration

test/
  rules.test.ts            Point, cooldown, tier, streak, and strength tests
  battles.test.ts          Battle layout tests
```

## Install dependencies

```bash
npm install
```

## Cloudflare configuration

The current `wrangler.toml` expects these bindings:

```toml
DB       = Cloudflare D1 database binding
BOT_KV   = Cloudflare KV namespace binding
BOT_TOKEN = Wrangler secret
```

The main configuration values are:

- `ENVIRONMENT` — deployment environment name
- `ADMIN_TELEGRAM_IDS` — comma-separated Telegram numeric user IDs allowed to run admin commands
- `DB` — D1 binding
- `BOT_KV` — KV binding
- `BOT_TOKEN` — Telegram bot token stored as a secret

Never commit `.dev.vars`, bot tokens, private keys, or account credentials.

## Local development

Apply the local D1 migrations:

```bash
npm run db:migrate
```

Run checks:

```bash
npm run typecheck
npm test
```

Start the local Worker:

```bash
npm run dev
```

The local health endpoint is:

```text
http://localhost:8787/health
```

The Worker accepts Telegram POST updates on any path, including:

```text
/telegram/webhook
/
/any-token-suffixed-path
```

For local Telegram testing, put a development token in `.dev.vars`:

```text
BOT_TOKEN=your-development-bot-token
```

Keep `.dev.vars` local and remove it when finished testing.

## Deploying to Cloudflare

Store the Telegram token as a Wrangler secret:

```bash
npx wrangler secret put BOT_TOKEN
```

Apply all D1 migrations to production:

```bash
npm run db:migrate:remote
```

Deploy the Worker:

```bash
npm run deploy
```

After deployment, register the Telegram webhook against your deployed Worker URL. The Worker accepts updates on `/telegram/webhook` and also accepts POST updates on other paths.

You can use Telegram's Bot API `setWebhook` method or another trusted Telegram administration tool. Do not place the bot token in source code, README files, shell history, or public issue reports.

## Register the Telegram command menu

After deployment, open this endpoint once in a browser or with an authenticated request:

```text
https://YOUR_WORKER_HOSTNAME/setup-commands
```

This registers the emoji command autocomplete menu with Telegram.

## Player commands

| Command | Purpose |
|---|---|
| `/start` | Create or open your player profile; accepts `/start referral_code` |
| `/help` | Show a short getting-started guide |
| `/commands` | Show the complete command list with emojis |
| `/balance` | Show Game, Spot, and Total Points |
| `/profile` | Show your full player card |
| `/profile @username` | View a public rival card |
| `/collect` | Claim points when your cooldown is ready |
| `/battle 50` | Open a challenge to a random player in your tier |
| `/battle @username 50` | Challenge a specific player |
| `/accept` | Accept the newest battle waiting for you |
| `/accept battle_id` | Accept a specific battle |
| `/leaderboard` | Show top collectors and battlers |
| `/quiz` | Receive a random multiple-choice quiz |
| `/react` | Claim the daily reaction reward |
| `/referral` | Show your referral link and referral status |

The inline buttons on the welcome card call the same action logic as the commands. They do not send fake bot-authored command messages back to the bot.

## Battle rules

- Wagers must be positive whole numbers.
- A player cannot wager more than their current Game Balance.
- A player cannot exceed their tier battle limit.
- Open battles are available to players in the same tier.
- Targeted battles can be accepted only by the tagged player.
- Targeted battles are announced in the group and sent privately to the opponent when Telegram allows private delivery.
- Battles expire after one hour if nobody accepts them.
- Previous battle wins influence future odds.
- Win probability is clamped between 25% and 75%, so experience matters without making battles impossible for new players.
- Battle winnings are internal points only.

## Quiz rules

The database contains 100 seeded questions plus the original starter question.

Quiz categories:

- `web3`
- `web2`
- `calculation`
- `jokes`
- `general` for the original starter question

Each player can make a maximum of **five quiz attempts per UTC day**. Both correct and incorrect answers count as attempts. A player cannot answer the same question twice.

Rewards use the seeded difficulty values:

- Easy: 40 points
- Medium: 75 points
- Hard: 120 points when added by an admin

To add an admin quiz question:

```text
/admin_quiz question|option 1|option 2|option 3|option 4|correct index|reward
```

The correct index is zero-based: `0`, `1`, `2`, or `3`.

## Referral rules

A player can share the link from `/referral`.

The invited player must complete three successful collects before the referrer receives the referral reward. This prevents immediate rewards from being farmed with inactive or disposable accounts.

Self-referrals and duplicate referrals are rejected.

## Collection and streak rules

The base collection reward is 100 points.

Tier cooldowns after the latest migration:

| Tier | Minimum Points | Cooldown | Battle Limit |
|---|---:|---:|---:|
| Starter | 0 | 5 minutes | 10 |
| Rising | 1,000 | 4 minutes | 25 |
| Elite | 5,000 | 3 minutes | 50 |
| Legend | 25,000 | 2 minutes | 100 |

Collect streak bonuses:

- Days 1–2: normal reward
- Day 3 onward: +10%
- Day 7 onward: +50%

## Admin commands

Set `ADMIN_TELEGRAM_IDS` to a comma-separated list of Telegram numeric user IDs.

```text
/admin_add_points telegram_id amount
/admin_quiz question|option 1|option 2|option 3|option 4|correct index|reward
```

Admin commands are ignored for users who are not listed in `ADMIN_TELEGRAM_IDS`.

## Scheduled maintenance

The Worker cron trigger runs every five minutes and:

- Deletes activity events older than seven days
- Expires pending battles older than one hour

The schedule is configured in `wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

## Security and abuse protection

The bot includes:

- Rolling activity limits of 30 actions per user per minute
- Atomic collection claims to prevent double collection
- Atomic battle resolution to prevent double acceptance and double payouts
- One quiz answer per user and question
- Five quiz attempts per user per UTC day
- One reaction reward per user per UTC day
- Self-referral rejection
- Duplicate referral rejection
- Delayed referral rewards after three qualifying collects
- HTML escaping for Telegram display names and leaderboard names
- Structured Worker and Telegram update error logs

## Verification commands

Run all local checks before deployment:

```bash
npm run typecheck
npm test
npm run db:migrate
```

Verify the local quiz distribution:

```bash
npx wrangler d1 execute golden_dog_db --local --command "SELECT category, COUNT(*) AS total FROM quiz_questions GROUP BY category;"
```

Verify the total question count:

```bash
npx wrangler d1 execute golden_dog_db --local --command "SELECT COUNT(*) AS total FROM quiz_questions;"
```

## Production checklist

- [ ] Confirm `wrangler.toml` contains the correct production D1 database ID
- [ ] Confirm the `BOT_KV` namespace ID is correct
- [ ] Set `ENVIRONMENT`
- [ ] Set `ADMIN_TELEGRAM_IDS`
- [ ] Store `BOT_TOKEN` with `npx wrangler secret put BOT_TOKEN`
- [ ] Run `npm run db:migrate:remote`
- [ ] Run `npm run deploy`
- [ ] Register the Telegram webhook
- [ ] Visit `/health`
- [ ] Visit `/setup-commands`
- [ ] Test `/start`
- [ ] Test `/collect`
- [ ] Test `/quiz` and the five-attempt limit
- [ ] Test `/battle` and `/accept`
- [ ] Test `/referral`

## License and ownership

This project is private application code. Add the license and contribution policy appropriate for your community before making the repository public.
