---
id: payments
title: Payment Gateway
short: Payments
color: #8b5cf6
blurb: Razorpay, Stripe, PayU and Cashfree integration flows, signature verification, webhooks, idempotency, refunds, reconciliation, subscriptions and the failure scenarios interviewers love.
---

## Cheatsheet
- Flow: ==create order on server → open checkout on client → verify signature on server → confirm via webhook==.
- **Never trust the frontend** for amount or success. The amount comes from your DB; success comes from a verified signature or webhook.
- Verify signatures with **HMAC-SHA256** and a **timing-safe compare**.
- Webhooks: verify signature on the **raw body**, return **2xx fast**, process in a queue, handle **duplicates and out-of-order** events.
- **Idempotency**: unique key per payment attempt + DB unique constraint → no double charges, no double fulfilment.
- Store money as **integers in the smallest unit** (paise/cents), never floats.
- Payment states: `created → pending → authorized → captured → refunded / failed`. Use a state machine.
- **Reconciliation** job compares your DB with the gateway's records daily and fixes "pending" orders.
- PCI DSS: don't store card numbers; use hosted checkout / tokenization so card data never touches your server.

## Integration Flow

### Explain the end-to-end payment flow (Razorpay / Stripe). {mid, hot}
1. User clicks **Pay**. Frontend calls your backend `POST /orders`.
2. Backend calculates the amount **from the DB** (cart, coupon, tax), creates an order in your DB (`status = created`), then creates an **order / PaymentIntent** at the gateway and stores its ID.
3. Backend returns the gateway order ID / client secret to the frontend.
4. Frontend opens the **gateway checkout** (Razorpay Checkout / Stripe Elements). Card, UPI or netbanking data goes **directly to the gateway**.
5. On success the gateway returns `payment_id`, `order_id`, `signature` to the frontend, which sends them to your backend.
6. Backend **verifies the signature** with the secret key, marks the order `paid` (idempotently).
7. Gateway also sends a **webhook** (`payment.captured`). Your server verifies it and updates the order if not already done. ==The webhook is the source of truth== because the user may close the browser before step 5.
8. Fulfil the order (email, inventory, invoice) in a queued job.

> [!say] "The client only starts the payment. The amount is decided on the server, success is decided by signature verification and the webhook, and fulfilment is idempotent."

### How do you verify the Razorpay payment signature? {mid, hot}
Razorpay signs `order_id + "|" + payment_id` with your **key secret** using HMAC-SHA256.

```js
const crypto = require('crypto');

function verifyPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));
}
```

```php
$expected = hash_hmac('sha256', $orderId . '|' . $paymentId, config('services.razorpay.secret'));
if (! hash_equals($expected, $signature)) abort(400, 'Invalid signature');
```

> [!warn] Use `timingSafeEqual` / `hash_equals`, not `===`, to avoid timing attacks. Also check that the `order_id` belongs to **this user's** order in your DB. Check lengths before `timingSafeEqual` because it throws if buffers differ in length.

### Why must the amount never come from the frontend? {basic, hot}
Anyone can change a request in DevTools or Postman. If your API accepts `amount: 1` from the client, a ₹50,000 order gets paid with ₹1.

==Always compute the amount on the server from the DB==, create the gateway order with it, and after payment **compare the captured amount and currency** with your order before marking it paid.

### Stripe PaymentIntent flow and 3D Secure / SCA {mid}
1. Server creates a **PaymentIntent** with amount and currency → returns `client_secret`.
2. Client confirms it with Stripe.js / Elements (`stripe.confirmPayment`).
3. If the bank needs **3D Secure** (SCA, required in EU and for many Indian cards as OTP), Stripe handles the challenge; status becomes `requires_action` then `succeeded`.
4. Server listens to `payment_intent.succeeded` / `payment_intent.payment_failed` **webhooks**.

Statuses: `requires_payment_method → requires_confirmation → requires_action → processing → succeeded / canceled`.

### Authorize vs capture; when do you use manual capture? {mid}
- **Authorization**: the bank **blocks** the money on the card.
- **Capture**: you actually **take** the money.

Auto-capture is normal for e-commerce. Use **manual capture** when the final amount or availability is only known later: hotel bookings, cab rides, marketplaces checking stock. Uncaptured authorizations **expire** (Razorpay auto-refunds after a few days; Stripe after ~7 days).

## Webhooks

### How do you handle webhooks reliably? {senior, hot}
1. **Verify the signature** using the webhook secret and the **raw request body** (not the parsed JSON, which changes formatting).
2. **Return 200 quickly** (within a few seconds) and push the work to a **queue**; otherwise the gateway times out and retries.
3. **Store the event ID** with a unique constraint; skip events already processed (gateways retry and can send duplicates).
4. Handle **out-of-order** events: check the current state before changing it (don't move `refunded` back to `captured`).
5. Make the processing **idempotent** and retry on failure; alert on repeated failures.
6. Run a **reconciliation** job in case a webhook never arrives.

```js
app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  const expected = crypto.createHmac('sha256', process.env.RZP_WEBHOOK_SECRET).update(req.body).digest('hex');
  if (sig !== expected) return res.status(400).end();   // use timingSafeEqual in production
  const event = JSON.parse(req.body);
  const inserted = await WebhookEvent.insertIgnore({ id: req.headers['x-razorpay-event-id'], type: event.event });
  if (inserted) await queue.add('payment-event', event);
  res.status(200).end();
});
```

### Webhook vs redirect/callback: which is the source of truth? {mid, hot}
The **webhook**. The frontend callback can be lost: the user closes the tab, network drops, the app crashes, or someone fakes the request. The webhook is sent **server to server, signed, and retried** by the gateway.

Use the frontend callback for **fast UX** (show "Payment successful" immediately after verifying the signature), and the webhook to **guarantee** the final state.

## Reliability & Money

### What is idempotency and how do you prevent double charges? {senior, hot}
An operation is **idempotent** if running it many times has the same effect as once.

Double payments happen from double clicks, retries after timeouts, duplicate webhooks, or a user paying in two tabs.

**Prevention:**
- Frontend: disable the Pay button after the first click.
- Create **one gateway order per checkout attempt** and reuse it if the user retries.
- Send an **Idempotency-Key** header to APIs that support it (Stripe) so a retry returns the original result.
- In your API: accept an `Idempotency-Key` from the client, store it with the response, and return the stored response for repeats.
- Database: **unique constraint** on `gateway_payment_id`; update with a condition (`UPDATE orders SET status='paid' WHERE id=? AND status='created'`) and fulfil only if a row changed.
- If money was captured twice, **auto-refund** the duplicate.

### Why store money as integers? {basic, hot}
Floating point can't represent decimals exactly: `0.1 + 0.2 = 0.30000000000000004`. Rounding errors add up in totals, taxes and refunds.

==Store amounts in the smallest unit as integers== (₹499.50 → `49950` paise), which is what Razorpay and Stripe expect. In SQL use `BIGINT` (or `DECIMAL(12,2)` if needed); always store the **currency** too.

### How do you design the payments database tables? {senior}
- `orders`: id, user_id, amount, currency, status, created_at.
- `payments`: id, order_id, gateway, gateway_order_id, **gateway_payment_id (unique)**, amount, status, method, failure_reason, raw_response (JSON), timestamps.
- `refunds`: id, payment_id, gateway_refund_id (unique), amount, status, reason.
- `webhook_events`: **event_id (unique)**, type, payload, processed_at, attempts.
- `payment_status_history` or an audit log for every state change.

One order can have **many payment attempts** (first failed, second succeeded). Never delete payment rows; they are financial records.

### How do refunds work, including partial refunds? {mid}
- Call the gateway refund API with the `payment_id` and amount (full or **partial**); store the refund with status `pending`.
- Refunds are **asynchronous**: final status comes via webhook (`refund.processed` / `refund.failed`). It takes 5–7 working days to reach the customer's bank.
- Validate: total refunded ≤ captured amount; use an idempotency key so a retried refund doesn't refund twice.
- Update order status (`partially_refunded`, `refunded`) and inventory.

### What is payment reconciliation? {senior, hot}
A scheduled job that **compares your records with the gateway's** (via API or settlement reports) and fixes differences:

- Order `pending` in your DB but `captured` at gateway → mark paid and fulfil (missed webhook).
- `captured` at gateway but no matching order → investigate / refund.
- Amount mismatches, missing refunds.
- **Settlement reconciliation**: check that money settled to your bank account matches captured payments minus fees and refunds.

```text
Every 15 min: find orders pending > 15 min → fetch status from gateway → update
Daily: download settlement report → match each line → flag mismatches
```

## Scenarios

### The user was charged but the order shows "failed". What happened and how do you fix it? {senior, hot}
**Likely causes:**
- User closed the browser / network dropped **after** paying but **before** the frontend called your verify API.
- Your verify API timed out or threw an error.
- Webhook not configured, signature check failing, or webhook endpoint returned 500.
- UPI / netbanking payments that complete **late** (pending for minutes).

**Fix:**
1. Make the **webhook the source of truth** and process it idempotently.
2. Add a **reconciliation job** that polls the gateway for orders stuck in `pending`.
3. If the order can't be fulfilled (stock gone), **auto-refund**.
4. Show the user "Payment processing" instead of "Failed" while the status is unknown.
5. Alert when the count of mismatched orders goes up.

### How do you implement subscriptions / recurring payments? {senior}
- Create a **plan** at the gateway and a **subscription** for the customer (Razorpay Subscriptions / Stripe Billing). For UPI AutoPay or card e-mandates, the customer approves a **mandate** once.
- The gateway charges on each cycle and sends webhooks: `subscription.charged`, `invoice.paid`, `payment_failed`, `subscription.halted`/`cancelled`.
- Your app extends access **only on the webhook**, keeps `current_period_end`, handles **dunning** (retry failed charges, email the user, grace period), upgrades/downgrades with **proration**, and cancellation at period end.

### How would you support multiple payment gateways? {senior}
Use the **strategy / adapter pattern**: one `PaymentGateway` interface (`createOrder`, `verify`, `refund`, `parseWebhook`), one class per provider, chosen by config, country, or availability.

Benefits: switch gateways without touching business logic, **fail over** to a second gateway if one is down, route by lowest fees or best success rate. Store `gateway` on every payment record.

### What is PCI DSS and how does it affect your code? {mid}
**PCI DSS** is the security standard for handling card data. If raw card numbers touch your servers you need heavy compliance (SAQ D).

Use **hosted checkout, iframes or SDK tokenization** (Razorpay Checkout, Stripe Elements) so card data goes straight to the gateway; you get a **token** instead (SAQ A). Never log card numbers or CVV. In India, RBI rules also require **card-on-file tokenization**; merchants can't store card numbers.

### How do you test payment integrations? {mid}
- Use the gateway's **test mode** keys and test cards / UPI IDs for success, failure and 3DS.
- Test webhooks locally with **ngrok** or the **Stripe CLI** (`stripe listen --forward-to localhost:3000/webhooks`).
- Unit test signature verification and the status state machine.
- Test failure paths: duplicate webhook, webhook before callback, timeout, partial refund, currency mismatch.
- Mock the gateway in automated tests (`Http::fake()`, nock).
