---
id: nodejs
title: Node.js
short: Node.js
color: #3c9a3f
blurb: Event loop, async patterns, streams, clustering, Express internals, security and the production questions that separate juniors from seniors.
---

## Cheatsheet
- Node is **single-threaded for JS**, but libuv runs a **thread pool (default 4)** for fs, dns.lookup, crypto, zlib.
- Event loop phases: ==timers → pending → poll → check → close==. `process.nextTick` and Promise microtasks run **between every phase**.
- Order: sync code → `nextTick` queue → Promise microtasks → timers / I/O / `setImmediate`.
- **Never block the loop**: heavy CPU work goes to `worker_threads`, a queue, or another service.
- Streams = process data in chunks; `pipeline()` handles errors and **backpressure**.
- Scale on one machine with **cluster / PM2** (one process per core); across machines with a load balancer.
- Always handle `unhandledRejection` and `uncaughtException`: log, then **exit and let the process manager restart**.
- Express middleware runs **in order**; an error handler has **4 args** `(err, req, res, next)`.
- Secrets in env vars, `helmet`, rate limiting, input validation, parameterized queries.

## Core & Event Loop

### What is Node.js and why is it fast for I/O-heavy apps? {basic, hot}
Node.js is a **JavaScript runtime built on Chrome's V8 engine** plus **libuv**, which provides the event loop and async I/O.

It is fast for I/O because of its ==non-blocking, event-driven model==: while one request waits for the database, the same thread serves other requests. There is no thread-per-request overhead.

- Great for: APIs, real-time apps (chat, sockets), streaming, BFF/gateway layers.
- Weak for: CPU-heavy work (image processing, big calculations) unless you use worker threads.

> [!say] "Node uses a single-threaded event loop with non-blocking I/O, so one process handles thousands of concurrent connections cheaply. CPU-heavy work is the weakness, and I move that to worker threads or a queue."

### Explain the event loop and its phases. {mid, hot}
The event loop lets Node do non-blocking I/O on a single JS thread. Each loop iteration ("tick") goes through phases:

1. **Timers**: callbacks from `setTimeout` / `setInterval` whose time is up.
2. **Pending callbacks**: some deferred system I/O callbacks (e.g. TCP errors).
3. **Poll**: get new I/O events and run their callbacks; it waits here if nothing else is scheduled.
4. **Check**: `setImmediate` callbacks.
5. **Close callbacks**: e.g. `socket.on('close')`.

==Between every phase (and after each callback) Node drains the `process.nextTick` queue first, then the Promise microtask queue.==

```js
console.log('1 sync');
setTimeout(() => console.log('5 timeout'), 0);
setImmediate(() => console.log('6 immediate'));
Promise.resolve().then(() => console.log('4 promise'));
process.nextTick(() => console.log('3 nextTick'));
console.log('2 sync');
// 1, 2, 3, 4, then 5/6 (order of timeout vs immediate can vary in the main module)
```

> [!tip] Inside an I/O callback, `setImmediate` **always** runs before `setTimeout(fn, 0)`. That detail impresses interviewers.

### `process.nextTick` vs `setImmediate` vs `setTimeout(fn, 0)` {mid, hot}
| API | When it runs |
|---|---|
| `process.nextTick` | Right after the current operation, **before** promises and before the loop continues |
| Promise `.then` | Microtask queue, after nextTick queue |
| `setTimeout(fn, 0)` | Timers phase of the next loop iteration (min ~1ms) |
| `setImmediate` | Check phase, right after poll |

> [!warn] Recursive `process.nextTick` can **starve the event loop**: I/O never gets a turn. Prefer `setImmediate` for deferring work.

### Is Node.js really single-threaded? {mid, hot}
**Your JavaScript runs on one thread**, but Node itself is not single-threaded:

- **libuv thread pool** (default 4, set via `UV_THREADPOOL_SIZE`) handles `fs`, `dns.lookup`, `crypto.pbkdf2`, `zlib`.
- Network I/O uses OS async mechanisms (epoll, kqueue, IOCP), not the thread pool.
- V8 has its own threads for garbage collection and compilation.
- You can create threads with `worker_threads`.

> [!key] If 4 slow `crypto.pbkdf2` calls are running, a 5th `fs.readFile` waits for a free pool thread. Raising `UV_THREADPOOL_SIZE` can fix hidden latency.

### What blocks the event loop and how do you detect it? {senior, hot}
Anything **synchronous and long**: `JSON.parse` of a huge payload, sync `fs.*Sync` calls, complex regex (ReDoS), big loops, sorting huge arrays, sync crypto.

**Detect:**
- `perf_hooks.monitorEventLoopDelay()` and alert when p99 lag rises.
- APM (Datadog, New Relic, Elastic) event loop lag metrics.
- `clinic doctor` / `clinic flame`, or `node --prof` and a flame graph.

**Fix:**
- Move CPU work to **worker_threads** or a background job queue (BullMQ).
- Split work into chunks with `setImmediate` between them.
- Stream large data instead of loading it all.

```js
const { monitorEventLoopDelay } = require('perf_hooks');
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => console.log('p99 lag ms', h.percentile(99) / 1e6), 5000);
```

### CommonJS vs ES Modules {basic}
| | CommonJS | ES Modules |
|---|---|---|
| Syntax | `require` / `module.exports` | `import` / `export` |
| Loading | Synchronous, at runtime | Static, async; enables tree-shaking |
| Top-level await | No | Yes |
| `__dirname` | Available | Use `import.meta.url` / `import.meta.dirname` |

Enable ESM with `"type": "module"` in package.json or the `.mjs` extension.

## Async Patterns

### Callbacks vs Promises vs async/await {basic, hot}
- **Callbacks**: error-first `(err, data)`; nesting leads to "callback hell" and hard error handling.
- **Promises**: chainable, one `.catch` for the chain, composable (`Promise.all`).
- **async/await**: syntax over promises; reads like sync code and uses `try/catch`.

> [!warn] `await` inside a `for` loop runs requests **one after another**. If they are independent, use `Promise.all` to run them in parallel.

### `Promise.all` vs `allSettled` vs `race` vs `any` {mid, hot}
| Method | Resolves when | Rejects when |
|---|---|---|
| `all` | All fulfil (array of values) | **First** rejection (fail-fast) |
| `allSettled` | All settle (status per item) | Never |
| `race` | First settles (either way) | First settles with a rejection |
| `any` | First **fulfils** | All reject (`AggregateError`) |

Use `allSettled` for dashboards where one widget failing should not break the page; `race` for timeouts.

```js
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))]);
```

### How do you limit concurrency (e.g. call an API for 10,000 users)? {senior, hot}
`Promise.all` on 10,000 calls opens 10,000 sockets at once. That can hit rate limits, exhaust memory or DB connections. ==Process in batches or use a pool with a fixed concurrency.==

```js
async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}
await mapLimit(users, 10, sendEmail);
```

Libraries: `p-limit`, `p-queue`, or move the work to a job queue (BullMQ) with workers.

### What is an EventEmitter? {basic}
Core class for the **pub/sub pattern**. Streams, HTTP servers and sockets all extend it.

```js
const EventEmitter = require('events');
class Order extends EventEmitter {}
const order = new Order();
order.on('paid', (id) => console.log('send invoice', id));
order.emit('paid', 42);
```

> [!warn] An `'error'` event with no listener **crashes the process**. Also watch for "MaxListenersExceededWarning", which usually means a listener leak.

## Streams & Buffers

### What are streams and why use them? {mid, hot}
Streams process data **piece by piece** instead of loading it all into memory. Four types: **Readable, Writable, Duplex, Transform**.

Example: serving a 2 GB file. `fs.readFile` loads 2 GB into RAM; a stream uses a few KB at a time.

```js
const { pipeline } = require('stream/promises');
const zlib = require('zlib');
await pipeline(
  fs.createReadStream('big.log'),
  zlib.createGzip(),
  fs.createWriteStream('big.log.gz')
);
```

Use cases: file upload/download, CSV export of millions of rows, video, proxying responses.

### What is backpressure? {senior}
When the writable side is **slower** than the readable side, data piles up in memory. Backpressure is the signal to pause: `writable.write()` returns `false`, and you wait for the `'drain'` event.

==`pipe()` and `pipeline()` handle backpressure automatically.== `pipeline` also destroys all streams and forwards the error if any of them fails, which plain `.pipe()` does not.

### What is a Buffer? {basic}
A fixed-size chunk of **raw binary memory** outside the V8 heap, used for files, network packets and images.

```js
const b = Buffer.from('hello', 'utf8');
b.toString('base64'); // aGVsbG8=
```

## Scaling & Processes

### Cluster module vs worker_threads vs child_process {senior, hot}
| | Use for | Memory |
|---|---|---|
| `cluster` | Run **one process per CPU core** sharing a port; scale an HTTP server | Separate memory per process |
| `worker_threads` | **CPU-heavy** tasks inside one process (image resize, hashing, parsing) | Can share memory (`SharedArrayBuffer`) |
| `child_process` | Run **another program** (ffmpeg, python script) | Separate process |

In production most teams use **PM2 cluster mode** or simply run multiple containers behind a load balancer (Kubernetes).

```bash
pm2 start server.js -i max   # one instance per core
```

### How do you make a Node app handle more traffic? {senior, hot}
1. **Don't block the loop**: profile, move CPU work out.
2. **Use all cores**: cluster / PM2 / multiple containers.
3. **Horizontal scaling** behind a load balancer; keep the app **stateless** (sessions in Redis, files in S3).
4. **Caching**: Redis for hot reads, HTTP caching, CDN for static files.
5. **Database**: indexes, connection pooling, read replicas, avoid N+1.
6. **Async jobs**: emails, PDFs, webhooks go to a queue.
7. **Compression & keep-alive**, and reverse proxy (Nginx) for TLS and static files.

> [!say] "First I measure: APM, event loop lag, slow queries. Then I fix the bottleneck, and only then scale out horizontally with a stateless design."

### How do you do a graceful shutdown? {senior}
On `SIGTERM` (sent by Kubernetes/PM2/Docker): stop accepting new connections, finish in-flight requests, close DB and Redis, then exit.

```js
process.on('SIGTERM', () => {
  server.close(async () => {
    await db.end();
    await redis.quit();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // force after 10s
});
```

## Express & APIs

### What is middleware in Express? {basic, hot}
A function `(req, res, next)` that runs in the request pipeline. It can **change req/res, end the response, or call `next()`** to pass control on. Order matters: they run in the order you `app.use()` them.

Types: application-level, router-level, built-in (`express.json()`), third-party (`cors`, `helmet`), and **error-handling** middleware.

```js
app.use(express.json());
app.use((req, res, next) => { req.start = Date.now(); next(); });
app.use('/api', authMiddleware, apiRouter);
app.use((err, req, res, next) => {        // 4 args = error handler
  console.error(err);
  res.status(err.status || 500).json({ message: 'Something went wrong' });
});
```

### How do you handle errors in async Express routes? {mid, hot}
In Express 4 a rejected promise inside a route is **not caught**; you must pass it to `next(err)`. Express 5 handles returned rejected promises automatically.

```js
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new NotFoundError('User not found');
  res.json(user);
}));
```

Use custom error classes (`AppError` with `statusCode`) and one central error handler that hides internals in production.

### How do you implement JWT authentication? {mid, hot}
1. Login: verify password (`bcrypt.compare`), sign a **short-lived access token** (15 min) and a **long-lived refresh token** (7–30 days).
2. Client sends `Authorization: Bearer <token>`.
3. Middleware verifies signature and expiry, attaches `req.user`.
4. Refresh endpoint issues a new access token; **rotate** refresh tokens and store them hashed in DB so you can revoke them.

```js
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}
```

> [!warn] JWTs can't be revoked before expiry by default. Keep them short-lived, store refresh tokens in an **httpOnly, Secure, SameSite cookie**, and keep a denylist for logout if needed.

### How do you implement rate limiting? {mid}
Limit requests per IP/user per time window to stop abuse and brute force. Algorithms: **fixed window, sliding window, token bucket**.

For multiple servers the counter must be shared, so use **Redis** (`rate-limit-redis` or a Lua script with `INCR` + `EXPIRE`). Return **429 Too Many Requests** with a `Retry-After` header. Stricter limits on `/login` and `/otp`.

### Node.js security best practices {mid, hot}
- Validate all input (`zod`, `joi`); use **parameterized queries / ORM** to stop SQL/NoSQL injection.
- `helmet` for security headers, strict **CORS** allowlist.
- Hash passwords with **bcrypt/argon2**, never plain or MD5.
- Secrets in env vars / secret manager, never in git.
- Rate limiting, account lockout on login.
- `npm audit`, Dependabot, lock file committed.
- Limit body size (`express.json({ limit: '100kb' })`) and avoid ReDoS regexes.
- Don't leak stack traces in production responses.

## Debugging & Production

### How do you find a memory leak in Node? {senior, hot}
**Symptoms:** memory (RSS / heap used) climbs steadily, GC pauses grow, then the process crashes with "heap out of memory".

**Common causes:** global caches/maps that never evict, event listeners added per request and never removed, closures holding big objects, timers not cleared, unbounded arrays/queues.

**Steps:**
1. Confirm with metrics (`process.memoryUsage()`, APM).
2. Take **heap snapshots** at intervals (`node --inspect` + Chrome DevTools, or `heapdump`) and **compare** them; look at what grows and its retainers.
3. Fix, e.g. use an **LRU cache with max size/TTL**, remove listeners, use `WeakMap`.

> [!say] "I take two or three heap snapshots under load, compare them, and follow the retainer chain of the objects that keep growing."

### `unhandledRejection` and `uncaughtException`: what should you do? {mid}
Log the error with context, flush logs, then **exit with a non-zero code** and let PM2/Kubernetes restart the process. After an uncaught exception the app is in an **unknown state**, so continuing is unsafe.

```js
process.on('unhandledRejection', (reason) => { logger.fatal(reason); process.exit(1); });
process.on('uncaughtException', (err) => { logger.fatal(err); process.exit(1); });
```

### How do you structure a production Node.js project? {mid}
Layered structure keeps logic testable:

- `routes/`: URL to controller mapping
- `controllers/`: read the request, call a service, send the response
- `services/`: business logic
- `repositories/` or `models/`: DB access
- `middlewares/`, `validators/`, `config/`, `utils/`, `jobs/`
- Central error handler, structured logger (pino/winston), config from env, health check endpoint (`/health`).
