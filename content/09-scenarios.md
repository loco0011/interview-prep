---
id: scenarios
title: Scenario-Based
short: Scenarios
color: #ec4899
blurb: "Production is down, what do you do?" Real situations with a step-by-step way to answer them: debugging, race conditions, scaling, security incidents and team situations.
---

## Cheatsheet
- Answer pattern: ==clarify → reproduce/measure → find root cause → fix → prevent it from happening again==.
- Always mention **monitoring, logs and metrics** first; never guess.
- In an outage: **mitigate first** (rollback, scale up, feature flag off), find the root cause after.
- Race conditions: **DB transaction + row lock**, atomic updates, unique constraints, distributed locks.
- Duplicate work: **idempotency keys** and unique constraints.
- Slow pages: measure with APM → slow query log → indexes / caching / queues.
- Bring numbers: "p95 went from 2.1s to 300ms", "cut the bundle by 40%".
- Close with **prevention**: tests, alerts, runbooks, a blameless post-mortem.

## Production Incidents

### Production API suddenly became slow. How do you debug it? {senior, hot}
1. **Scope it**: all endpoints or one? All users or some? Since when? Anything deployed or changed (code, config, traffic, data size)?
2. **Check dashboards**: latency p95/p99, error rate, CPU, memory, DB connections, queue length, event loop lag.
3. **Mitigate if users are hurting**: roll back the last deploy, scale out, disable the heavy feature with a flag.
4. **Trace a slow request** with APM to see where time goes: DB, external API, CPU.
5. **Database**: slow query log, `EXPLAIN` the top queries, check for missing indexes, locks, N+1 queries.
6. **External calls**: is a third-party API slow? Add **timeouts, retries with backoff and circuit breakers**.
7. **Fix and verify** with the same metrics, then write a post-mortem and add an alert.

> [!say] "First I stop the bleeding, then I find out where the time is going with data, not guesses. Most of the time it's a query, a missing index, or a slow external call."

### The server crashes with "out of memory" every few hours. {senior, hot}
- Memory grows steadily, so it's a **leak**, not a spike. Confirm with memory metrics over time.
- **Node**: take heap snapshots a few minutes apart and compare (growing arrays/maps, listeners, closures). **PHP**: long-running workers (queue, Octane) leak through static arrays; restart workers with `--max-jobs` / `--max-time`.
- Look for **unbounded caches**, loading whole tables into memory (`Model::all()`), large file reads instead of streams.
- Short term: restart policy + memory limit; long term: fix the leak, add an LRU with TTL, stream data, alert on memory growth.

### A deploy broke production. What do you do? {mid, hot}
1. **Roll back immediately** to the last good version (that's why we keep versioned images/releases). Don't debug in production while users are failing.
2. Communicate in the incident channel: what's broken, impact, ETA.
3. Check if the deploy included a **DB migration**; rollback must be safe, which is why migrations should be backward compatible.
4. Reproduce on staging, fix, add a **test** that would have caught it.
5. Post-mortem: why didn't CI/staging catch it? Add canary deploys or feature flags.

### Users report they are randomly logged out. {mid}
Likely causes:
- Multiple servers with **sessions stored in local files**: load balancer sends the user to a server without their session. Fix: Redis/DB sessions or sticky sessions.
- `APP_KEY` / JWT secret **differs between servers** or changed on deploy.
- Cookie domain/`SameSite`/`Secure` misconfigured (HTTP vs HTTPS, subdomain).
- Token refresh race: two tabs refresh at the same time and the rotated refresh token invalidates the other.

## Data & Concurrency

### Two users buy the last item at the same time. How do you prevent overselling? {senior, hot}
This is a **race condition**: both read `stock = 1`, both decrement.

Solutions:
1. **Atomic conditional update** (simplest, very fast):
```sql
UPDATE products SET stock = stock - 1 WHERE id = ? AND stock >= 1;
-- affected rows = 0 → out of stock
```
2. **Pessimistic lock** inside a transaction: `SELECT ... FOR UPDATE` (`lockForUpdate()` in Laravel).
3. **Optimistic locking**: a `version` column; update `WHERE id = ? AND version = ?`, retry if no row changed.
4. For flash sales with huge traffic: keep stock in **Redis** with atomic `DECR` or a Lua script, put orders in a **queue**, and process them in order.
5. **Reserve stock** for a few minutes at checkout and release it if payment fails.

### A cron job runs twice and sends duplicate emails / charges. {mid, hot}
- With several servers, every server runs the cron. Use **one scheduler** (`onOneServer()` in Laravel) or a **distributed lock** (Redis `SET key value NX EX 60`).
- Make the job **idempotent**: track `email_sent_at` or a unique `(user_id, campaign_id)` row before sending.
- Use `withoutOverlapping()` so a slow run doesn't overlap the next one.

### You need to add a column to a table with 50 million rows without downtime. {senior}
- A plain `ALTER TABLE` may **lock the table** for minutes. MySQL 8 supports `ALGORITHM=INSTANT` for adding columns in many cases; otherwise use **gh-ost** or **pt-online-schema-change**, which copy the table in the background.
- Add the column **nullable** (no default backfill in one go), **backfill in batches** with a job (`chunkById`), then add constraints/indexes later.
- Deploy code in steps (**expand → migrate → contract**) so old and new versions both work during the rollout.

### How would you migrate data from an old system to a new one? {senior}
- Map the schemas, write an idempotent migration script that runs in **batches** and can be **resumed**.
- Dry run on a copy of production; compare counts and checksums.
- **Dual write** (write to old and new) or CDC (change data capture) while you backfill history.
- Switch reads gradually behind a feature flag; keep a rollback plan.

## Scaling & Design

### Your app must handle 10x traffic for a sale next week. What do you do? {senior, hot}
1. **Load test** now (k6, JMeter, Artillery) on staging to find the breaking point.
2. **Cache** everything read-heavy: product pages via CDN, Redis for catalogue and sessions.
3. **Scale out** app servers behind the load balancer; set up **autoscaling**; make sure the app is stateless.
4. **Database**: add read replicas, connection pooling, indexes for the hot queries; avoid heavy reports during the sale.
5. Move slow work to **queues** (emails, invoices) and scale workers.
6. Protect the system: **rate limiting**, a virtual waiting room, graceful degradation (turn off recommendations).
7. Prepare **dashboards, alerts and a runbook**; freeze non-critical deploys.

### Design a feature to export 1 million rows to CSV. {mid, hot}
Never do it in the request: it will time out and eat memory.
1. User clicks **Export** → API creates an `exports` record (`status = queued`) and dispatches a **job**. Respond immediately.
2. Job **streams** rows in chunks (`chunkById` / DB cursor) and writes them to a file stream, upload to **S3**.
3. Update status to `done`, notify the user (email / WebSocket / polling) with a **signed, expiring download URL**.
4. Limit concurrent exports per user; clean old files with a lifecycle rule.

### How would you build real-time notifications? {mid}
- **WebSockets** (Socket.IO, Laravel Reverb/Pusher) for two-way, instant updates; **Server-Sent Events** for one-way server → client; polling as a fallback.
- With several servers, use a **Redis pub/sub adapter** so a message reaches users connected to any server.
- Store notifications in the DB too (read/unread), so users see them after reconnecting.
- Push notifications (FCM/APNs) for mobile when the app is closed.

### A third-party API you depend on is slow or down. How do you protect your app? {senior, hot}
- **Timeouts** on every call (never wait forever).
- **Retries with exponential backoff and jitter**, only for safe/idempotent requests.
- **Circuit breaker**: after N failures, stop calling for a while and fail fast or use a fallback.
- **Cache** the last good response; serve stale data if acceptable.
- Move the call to a **queue** so the user isn't blocked; notify when done.
- Monitor its latency and error rate separately; agree on SLAs.

## Security Scenarios

### You found that an API key was committed to a public GitHub repo. {mid, hot}
1. **Revoke / rotate the key immediately.** Deleting the commit is not enough; bots scan GitHub within minutes and history keeps the key.
2. Check the provider's logs for misuse (unexpected charges, data access).
3. Remove it from history (`git filter-repo` / BFG) and force-push if needed; still treat it as leaked.
4. Prevent: secrets in env/secret manager, `.gitignore` for `.env`, **pre-commit secret scanning** (gitleaks), GitHub push protection.

### Your login endpoint is under a brute-force attack. {mid}
- **Rate limit** by IP and by account (`throttle` / Redis), with exponential delays.
- Temporary account lockout or **CAPTCHA** after N failures; alert the user.
- Block abusive IPs at the WAF / Cloudflare.
- Encourage **2FA**; return the same generic error for wrong email and wrong password (no user enumeration).
- Monitor failed-login metrics.

## Team & Behavioural

### Tell me about a difficult bug you fixed. {mid, hot}
Use **STAR**: Situation, Task, Action, Result.

> [!tip] Example structure: "Orders were sometimes marked paid twice (Situation). I owned the fix (Task). I found duplicate webhooks and the verify API racing each other, added a unique constraint on payment ID and a conditional status update, and made fulfilment idempotent (Action). Duplicate fulfilments dropped to zero and we added an alert (Result)."

Pick a real bug with a clear root cause and a measurable result.

### How do you handle disagreement on a technical decision? {basic}
Listen to the reasons, bring **data** (benchmarks, a small prototype, past incidents), write the trade-offs down, and agree on a decision owner. Once decided, commit fully even if your option wasn't chosen. Revisit with data if problems appear.

### You have a tight deadline and the code isn't perfect. What do you do? {basic}
Agree on the **minimum scope** with the product owner, ship the critical path with tests for the risky parts, use feature flags, and **record the technical debt** as tickets with a plan to fix it. Never skip security or data-integrity work to save time.
