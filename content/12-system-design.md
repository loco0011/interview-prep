---
id: system-design
title: System Design
short: System Design
color: #5f7391
blurb: REST API design, microservices vs monolith, queues, caching, rate limiters and the classic design rounds (URL shortener, notifications, e-commerce checkout) explained at full-stack level.
---

## Cheatsheet
- Design round structure: ==requirements → estimates → API → data model → high-level diagram → deep dive → bottlenecks and trade-offs==.
- Ask for **functional** (what it does) and **non-functional** (scale, latency, availability, consistency) requirements first.
- **CAP**: during a network partition choose Consistency or Availability.
- Stateless app servers + load balancer + cache + DB (replicas) + queue + CDN covers most designs.
- Monolith first; split into services when team size or scaling needs justify it.
- REST: nouns for resources, HTTP verbs for actions, correct status codes, versioning, pagination.
- Async work and spikes → **message queue**; events between services → **pub/sub**.
- Always discuss **failure**: retries, timeouts, idempotency, dead-letter queues, monitoring.

## API Design

### What makes a good REST API? {mid, hot}
- **Resources as nouns**: `GET /orders`, `GET /orders/42`, `POST /orders`, `PATCH /orders/42`, `DELETE /orders/42`.
- Nested where natural: `GET /users/7/orders`.
- Correct **status codes**: 200, 201 Created, 204 No Content, 400 validation, 401 not logged in, 403 forbidden, 404, 409 conflict, 422, 429, 500.
- **Pagination, filtering, sorting**: `?page=2&limit=20&status=paid&sort=-created_at`.
- **Versioning**: `/api/v1/...` or a header.
- Consistent error shape: `{ "error": { "code": "OUT_OF_STOCK", "message": "..." } }`.
- **Idempotent** `PUT`/`DELETE`; idempotency keys for `POST` payments.
- Auth (Bearer tokens), rate limiting, HTTPS only, OpenAPI documentation.

### PUT vs PATCH; which HTTP methods are idempotent? {basic, hot}
- `PUT` **replaces** the whole resource; `PATCH` **updates some fields**.
- Idempotent (same result if repeated): `GET`, `PUT`, `DELETE`, `HEAD`, `OPTIONS`.
- **Not idempotent**: `POST` (creates a new resource each time), `PATCH` (can be, depending on the operation, e.g. "increment" is not).
- Safe (no changes): `GET`, `HEAD`, `OPTIONS`.

### REST vs GraphQL vs gRPC {mid}
| | REST | GraphQL | gRPC |
|---|---|---|---|
| Shape | Fixed endpoints | Client asks for exact fields | Typed RPC methods (protobuf) |
| Pros | Simple, HTTP caching | No over/under-fetching, one endpoint | Fast, binary, streaming |
| Cons | Over-fetching, many calls | Caching and N+1 complexity | Not browser-native |
| Use | Public APIs, most apps | Complex UIs, mobile | Service-to-service |

### How do you secure an API? {mid, hot}
- HTTPS everywhere; authentication (JWT / OAuth2 / Sanctum tokens), **authorization on every endpoint** (check ownership: can user 7 see order 42?).
- Input validation, parameterized queries, output encoding.
- Rate limiting and request size limits; CORS allowlist.
- Don't expose internal IDs or stack traces where it matters; use UUIDs for public IDs if needed.
- Logging and alerting on suspicious activity; OWASP API Top 10 (broken object-level authorization is #1).

## Architecture

### Monolith vs microservices {mid, hot}
| | Monolith | Microservices |
|---|---|---|
| Deploy | One unit | Each service separately |
| Pros | Simple to build, test, debug; fast early on | Independent scaling and deploys, team autonomy, fault isolation |
| Cons | Grows tangled; whole app redeploys; scales as one | Network failures, distributed data, complex ops, harder debugging |

> [!say] "I'd start with a well-structured modular monolith and extract services when there's a clear reason: a part with very different scaling needs, or teams blocked on each other."

### How do microservices communicate? {senior}
- **Synchronous**: REST/gRPC calls. Simple, but creates coupling and cascading failures; needs timeouts, retries, circuit breakers.
- **Asynchronous**: events through **Kafka, RabbitMQ, SQS/SNS**. Services stay decoupled and survive downtime of others.
- **API Gateway** in front for routing, auth and rate limiting.
- Data: each service owns its DB. Multi-service workflows use the **Saga pattern** (local transactions + compensating actions) instead of distributed transactions; the **outbox pattern** publishes events reliably.

### Why use a message queue? Kafka vs RabbitMQ {mid, hot}
Queues **decouple** producers from consumers, **absorb traffic spikes**, allow **retries**, and let slow work run in the background.

- **RabbitMQ / SQS**: classic task queues; a message is consumed once and removed; routing, priorities, dead-letter queues.
- **Kafka**: a durable, ordered **log**; many consumer groups can re-read events; very high throughput; great for event streaming and analytics.

Always handle: **at-least-once delivery** (so consumers must be idempotent), **dead-letter queues**, retries with backoff, and monitoring queue length.

### What is the CAP theorem? {mid}
In a distributed system, during a **network Partition** you must choose between **Consistency** (every read sees the latest write) and **Availability** (every request gets a response).
- **CP**: banking balances, inventory counts: refuse requests rather than be wrong.
- **AP**: social feeds, likes, product views: always respond, eventually consistent.

### What is a load balancer and what algorithms does it use? {basic}
A load balancer spreads requests across servers and removes unhealthy ones using **health checks**.
- Algorithms: **round robin**, least connections, IP hash (sticky), weighted.
- L4 (TCP) vs L7 (HTTP: route by path/host, TLS termination).
- Examples: Nginx, HAProxy, AWS ALB/NLB, Cloudflare.

## Design Problems

### Design a URL shortener. {mid, hot}
**Requirements**: create short link, redirect fast, optional expiry and analytics. Reads ≫ writes (100:1).

**API**: `POST /links {url}` → `{code}`; `GET /:code` → **301/302** redirect.

**Code generation**:
- Auto-increment ID → **Base62** encode (7 chars = 3.5 trillion codes). Predictable, but simple.
- Or random 7 chars with a unique constraint and retry on collision.

**Storage**: `links(code PK, url, user_id, expires_at, created_at)`.

**Scale**: cache hot codes in **Redis** (most traffic hits few links), CDN/edge redirects, read replicas. Analytics: push click events to a **queue** and aggregate asynchronously, so the redirect stays fast.

> [!tip] 301 is cached by browsers (fewer hits, less analytics). 302 hits your server every time (accurate analytics).

### Design a notification system (email, SMS, push). {senior, hot}
- Services call a **Notification API** with `user_id`, template and data.
- API checks **user preferences** and opt-outs, renders templates, then puts one message per channel on a **queue**.
- **Channel workers** send via providers (SES/SendGrid, Twilio/MSG91, FCM/APNs), with **retries, backoff and a dead-letter queue**; fail over to a second provider.
- **Idempotency key** per notification so retries don't double-send; **rate limits** per user.
- Store status (queued, sent, delivered, failed) and provider callbacks; priority queues so OTPs aren't stuck behind marketing emails.

### Design the checkout of an e-commerce site. {senior, hot}
1. **Cart** in DB/Redis; prices re-validated on the server at checkout.
2. **Reserve inventory** for N minutes (atomic decrement or reservation table with expiry).
3. Create **order** (`pending_payment`) with an idempotency key; create gateway order.
4. Payment via gateway; confirmation through **signature verification + webhook**.
5. On success: order `paid` → event `OrderPaid` → queue consumers: invoice, email, shipping, analytics.
6. On failure/timeout: release reservation; **reconciliation job** catches stuck orders.

Concerns to mention: double clicks (idempotency), overselling (locks/atomic updates), flash-sale load (queue + waiting room), consistency between order and payment (state machine + webhooks), observability.

### Design a rate limiter. {senior}
- Where: API gateway or middleware; key by user ID / API key / IP.
- Algorithms: **token bucket** (allows short bursts, common), **sliding window log/counter** (accurate), fixed window (simple, burst at edges).
- Store counters in **Redis** so all servers share them; use a Lua script or `INCR` + `EXPIRE` for atomicity.
- Response: **429** with `Retry-After` and `X-RateLimit-Remaining` headers.
- Different limits per plan/endpoint; fail open or closed if Redis is down (decide and explain).

### Design a chat application. {senior}
- **WebSocket** connections to chat servers; a connection registry (user → server) in Redis.
- Send message → persist to DB (Cassandra/Mongo/Postgres partitioned by conversation) → publish via **Redis pub/sub / Kafka** to the server holding the recipient's socket.
- Offline users get **push notifications**; on reconnect, fetch messages after the last seen ID.
- Message IDs ordered per conversation; delivery/read receipts as events; media in S3 via signed URLs.
- Scale: horizontal chat servers behind an L4 load balancer, sticky connections, presence with TTL heartbeats.
