---
id: performance
title: Performance
short: Performance
color: #14b8a6
blurb: Backend, database and frontend performance: caching layers, query tuning, Core Web Vitals, bundle size, load testing and how to explain the numbers you improved.
---

## Cheatsheet
- ==Measure first, optimise second.== Use APM, profilers, slow query logs, Lighthouse.
- Talk in **percentiles** (p95, p99), not averages.
- Biggest backend wins: **indexes, fixing N+1, caching, queues, connection pooling**.
- Cache layers: browser → CDN → reverse proxy → app (Redis) → DB buffer pool.
- Core Web Vitals: **LCP < 2.5s**, **INP < 200ms**, **CLS < 0.1**.
- Frontend wins: code splitting, smaller JS, image optimisation, lazy loading, preloading critical assets.
- Long lists → **virtualization**; frequent events → **debounce/throttle**.
- Pagination: **cursor/keyset** beats `OFFSET` on large tables.
- Load test before big events (k6, JMeter, Artillery) and find the bottleneck.

## Backend

### How do you approach a performance problem in general? {mid, hot}
1. **Define the goal**: "checkout API p95 under 300ms".
2. **Measure** where time goes: APM traces, profilers (clinic.js, Xdebug/Blackfire), slow query log.
3. **Find the biggest bottleneck** (usually DB or external calls) and fix only that.
4. **Verify** with the same measurement; check you didn't break anything.
5. Repeat; add **monitoring/alerts** so regressions are caught.

> [!say] "I never optimise blind. I profile, fix the top bottleneck, measure again. In my last project fixing an N+1 and adding one composite index took the orders API from 1.8s to 220ms p95."

### Explain caching strategies. {mid, hot}
| Strategy | How it works | Good for |
|---|---|---|
| **Cache-aside** (lazy) | App reads cache; on miss loads DB and writes cache | Most read-heavy data |
| **Write-through** | Write to cache and DB together | Data that must be fresh in cache |
| **Write-behind** | Write to cache, DB updated later (async) | High write throughput, risk of loss |
| **Read-through** | Cache library loads from DB itself | Simpler app code |

Plus: **TTL**, eviction policies (**LRU**, LFU), cache warming.

```js
async function getProduct(id) {
  const key = `product:${id}`;
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);
  const product = await db.products.findById(id);
  await redis.set(key, JSON.stringify(product), 'EX', 600);
  return product;
}
```

### What is a cache stampede and how do you prevent it? {senior}
A popular key expires and **thousands of requests miss at the same time**, all hitting the DB together.

Prevent it with:
- A **lock / single flight**: only one request rebuilds; the others wait or get the stale value.
- **Stale-while-revalidate**: serve the old value while refreshing in the background.
- **Random jitter** on TTLs so keys don't expire together.
- **Pre-warm** hot keys before they expire.

### What is connection pooling and why does it matter? {mid}
Opening a DB connection is expensive (TCP + auth). A **pool** keeps connections open and reuses them.

- Too small → requests wait for a connection. Too large → DB runs out of memory/connections (`max_connections`).
- Many app instances × pool size must stay below the DB limit; use **PgBouncer / RDS Proxy** for many short-lived clients (serverless).
- PHP-FPM uses one connection per worker; persistent connections are optional.

### How do you make API responses faster? {mid, hot}
- Return **only needed fields**; paginate; compress responses (gzip/brotli).
- Remove N+1, add indexes, cache expensive results.
- Run independent calls **in parallel** (`Promise.all`).
- Move non-critical work (emails, logs, analytics) to **queues**.
- Use HTTP caching: `ETag`, `Cache-Control`, CDN for public GET endpoints.
- Keep-alive connections, HTTP/2, servers close to users.

## Database

### How do you find and fix a slow SQL query? {mid, hot}
1. Find it: **slow query log**, APM, `pg_stat_statements`, Laravel Telescope.
2. Run **`EXPLAIN` / `EXPLAIN ANALYZE`**. Look for `type: ALL` (full table scan), large `rows`, `Using filesort`, `Using temporary`.
3. Add the right **index** (often a composite one matching `WHERE` + `ORDER BY`).
4. Rewrite: avoid `SELECT *`, avoid functions on indexed columns (`WHERE DATE(created_at) = ...` → use a range), avoid leading wildcards `LIKE '%abc'`.
5. Reduce work: pagination, summary tables, caching.

```sql
-- Before: full scan
SELECT * FROM orders WHERE user_id = 42 AND status = 'paid' ORDER BY created_at DESC LIMIT 20;
-- Fix: composite index matching filter + sort
CREATE INDEX idx_orders_user_status_created ON orders (user_id, status, created_at);
```

### Why is `OFFSET` pagination slow? What's the alternative? {senior, hot}
`LIMIT 20 OFFSET 1000000` makes the DB **read and throw away a million rows**. It gets slower the deeper you go, and rows shift if data changes between pages.

**Keyset (cursor) pagination** remembers the last seen value:

```sql
SELECT * FROM orders WHERE id < :last_id ORDER BY id DESC LIMIT 20;
```

It uses the index directly, so it's fast at any depth. Trade-off: no "jump to page 500". Laravel: `cursorPaginate()`.

## Frontend

### What are Core Web Vitals and how do you improve them? {mid, hot}
| Metric | Measures | Good | Improve by |
|---|---|---|---|
| **LCP** | Largest content visible | < 2.5s | Faster server/CDN, preload hero image, SSR, compress images |
| **INP** | Response to interactions | < 200ms | Less JS on main thread, split long tasks, web workers |
| **CLS** | Layout jumping | < 0.1 | Set width/height on images/ads, reserve space, `font-display` |

Measure in the field (real users, CrUX / `web-vitals` library) and in the lab (Lighthouse).

### How do you reduce bundle size? {mid, hot}
- **Analyse** first: `vite-bundle-visualizer`, `webpack-bundle-analyzer`.
- **Code splitting** by route and for heavy components (`React.lazy`, dynamic `import()`).
- **Tree-shaking**: import only what you use (`import debounce from 'lodash/debounce'`).
- Replace heavy libraries (moment → dayjs, big chart libs → lighter ones).
- Remove dead code and polyfills you don't need; target modern browsers.
- Compress (brotli), long-term caching with hashed filenames, CDN.

### How do you optimise images? {basic}
- Modern formats: **WebP / AVIF**.
- Responsive sizes with `srcset` and `sizes`; don't send a 3000px image to a phone.
- `loading="lazy"` for below-the-fold images; **preload / `fetchpriority="high"`** for the LCP image.
- Always set `width` and `height` to avoid layout shift.
- Serve through an image CDN that resizes on the fly.

### How do you render 10,000 rows smoothly? {mid, hot}
Render only what's visible: **virtualization / windowing** (`react-window`, TanStack Virtual). The DOM keeps ~30 rows and swaps content while scrolling.

Also: paginate or infinite-scroll from the server, memoize row components, avoid heavy work in render, and debounce filters.

### Browser rendering: what are reflow and repaint? {senior}
- **Reflow (layout)**: the browser recalculates sizes and positions. Expensive; triggered by changing width/height/fonts or reading layout (`offsetHeight`) after writing styles.
- **Repaint**: redraw pixels without layout changes (color, shadow).
- **Composite-only** changes (`transform`, `opacity`) are cheapest and can run on the GPU.

Avoid **layout thrashing** (reading and writing layout in a loop); batch reads and writes; animate `transform` and `opacity` only.

## Load Testing

### How do you load test an application? {senior}
- Tools: **k6**, JMeter, Artillery, Locust.
- Define realistic scenarios (browse → add to cart → pay) and target numbers (requests/second, concurrent users).
- Ramp up gradually and watch latency percentiles, error rate, CPU, DB connections, queue length.
- Find the **first bottleneck**, fix, repeat. Test in a production-like environment.

```js
import http from 'k6/http';
export const options = { stages: [{ duration: '2m', target: 500 }, { duration: '5m', target: 500 }] };
export default function () { http.get('https://staging.example.com/api/products'); }
```

### Latency vs throughput; why use percentiles? {mid}
- **Latency**: time for one request. **Throughput**: requests handled per second.
- Averages hide pain: if p50 is 100ms but **p99 is 4s**, 1 in 100 users waits 4 seconds, and heavy users hit it often.
- Set goals on **p95/p99**.
