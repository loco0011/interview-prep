---
id: databases
title: Databases
short: Databases
color: #b7791f
blurb: MySQL, PostgreSQL, MongoDB and Redis: indexes, joins, transactions and isolation, normalization, SQL vs NoSQL, and the query-writing questions asked in coding rounds.
---

## Cheatsheet
- **ACID**: Atomicity, Consistency, Isolation, Durability.
- Indexes are usually **B-trees**; composite index follows the **leftmost prefix** rule.
- Index columns used in `WHERE`, `JOIN`, `ORDER BY`; too many indexes slow down writes.
- `INNER JOIN` = matching rows only; `LEFT JOIN` = all left rows + matches (or NULL).
- `WHERE` filters rows **before** grouping; `HAVING` filters **after** `GROUP BY`.
- Isolation levels: Read Uncommitted → Read Committed → **Repeatable Read (MySQL default)** → Serializable.
- SQL for relations and transactions (orders, payments); NoSQL for flexible schemas and huge scale.
- Redis: cache, sessions, rate limits, queues, locks, leaderboards; data lives **in memory**.

## SQL Fundamentals

### What is an index and how does it work? {basic, hot}
An index is a separate data structure (usually a **B+ tree**) that keeps column values sorted with pointers to rows, so the DB can **find rows without scanning the whole table**, like a book index.

- Speeds up `WHERE`, `JOIN`, `ORDER BY`, `GROUP BY`.
- Costs disk space and **slows down INSERT/UPDATE/DELETE** (each index must be updated).
- **Clustered index** (InnoDB primary key): the table rows are stored in PK order. **Secondary indexes** store the PK to find the row.
- **Covering index**: contains all columns the query needs, so the table isn't touched.

### Composite indexes and the leftmost prefix rule {mid, hot}
An index on `(user_id, status, created_at)` can be used for:
- `WHERE user_id = ?`
- `WHERE user_id = ? AND status = ?`
- `WHERE user_id = ? AND status = ? ORDER BY created_at`

But **not** efficiently for `WHERE status = ?` alone, because `user_id` (the leftmost column) is missing.

==Order columns: equality filters first, then range filters / sort column.==

### Types of joins {basic, hot}
| Join | Returns |
|---|---|
| `INNER JOIN` | Rows with a match in both tables |
| `LEFT JOIN` | All rows from left + matches from right (NULL if none) |
| `RIGHT JOIN` | All rows from right + matches from left |
| `FULL OUTER JOIN` | All rows from both (not in MySQL; use UNION) |
| `CROSS JOIN` | Every combination |
| Self join | A table joined to itself (employee → manager) |

```sql
-- Users who never placed an order
SELECT u.* FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE o.id IS NULL;
```

### `WHERE` vs `HAVING`, `GROUP BY` {basic}
`WHERE` filters rows **before** grouping; `HAVING` filters **groups** after aggregation.

```sql
SELECT user_id, COUNT(*) AS orders, SUM(amount) AS total
FROM orders
WHERE status = 'paid'
GROUP BY user_id
HAVING SUM(amount) > 10000
ORDER BY total DESC;
```

### Classic SQL questions: second-highest salary, duplicates, top N per group {mid, hot}
```sql
-- Second highest salary
SELECT MAX(salary) FROM employees WHERE salary < (SELECT MAX(salary) FROM employees);
-- or with window functions (handles ties)
SELECT salary FROM (
  SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS r FROM employees
) t WHERE r = 2 LIMIT 1;

-- Find duplicate emails
SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;

-- Top 3 earners in each department
SELECT * FROM (
  SELECT e.*, ROW_NUMBER() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn FROM employees e
) t WHERE rn <= 3;
```

> [!tip] Know `ROW_NUMBER` vs `RANK` vs `DENSE_RANK`: with ties (100, 100, 90) they give 1,2,3 / 1,1,3 / 1,1,2.

### What is normalization? When do you denormalize? {mid}
Normalization organises tables to **remove duplicate data** and update anomalies.
- **1NF**: atomic values, no repeating groups.
- **2NF**: no partial dependency on part of a composite key.
- **3NF**: no transitive dependency (non-key column depending on another non-key column).

**Denormalize** for read performance: store `order_total` or `comments_count`, summary/reporting tables, copying product name into `order_items` (also needed historically: the product price at time of order).

## Transactions

### What does ACID mean? {basic, hot}
- **Atomicity**: all statements in a transaction succeed or none do.
- **Consistency**: the DB moves from one valid state to another (constraints hold).
- **Isolation**: concurrent transactions don't see each other's partial work.
- **Durability**: once committed, data survives crashes (written to the log).

Example: transfer money: debit A and credit B must both happen or neither.

### Explain isolation levels and read anomalies. {senior, hot}
| Level | Dirty read | Non-repeatable read | Phantom read |
|---|---|---|---|
| Read Uncommitted | Possible | Possible | Possible |
| Read Committed (Postgres default) | No | Possible | Possible |
| Repeatable Read (MySQL default) | No | No | Possible* |
| Serializable | No | No | No |

- **Dirty read**: reading uncommitted data from another transaction.
- **Non-repeatable read**: same row read twice gives different values.
- **Phantom read**: same query returns new rows.

*InnoDB prevents most phantoms with next-key (gap) locks. Higher isolation = more locking and less concurrency.

### What is a deadlock and how do you handle it? {senior}
Two transactions each hold a lock the other needs, so both wait forever. The DB detects it and **kills one** (MySQL error 1213).

- **Retry** the failed transaction (Laravel `DB::transaction($fn, 3)`).
- Always lock rows in the **same order** (e.g. by ascending ID).
- Keep transactions **short**; don't call external APIs inside them.
- Proper indexes so updates lock fewer rows.

## NoSQL & Redis

### SQL vs NoSQL: when to use which? {mid, hot}
| | SQL (MySQL, Postgres) | NoSQL (MongoDB, DynamoDB) |
|---|---|---|
| Schema | Fixed, enforced | Flexible documents |
| Relations | Joins, foreign keys | Embed or reference; joins are limited |
| Transactions | Strong ACID | Supported, but designed around single documents |
| Scaling | Vertical + read replicas, sharding is harder | Built for horizontal sharding |
| Best for | Orders, payments, inventory, reporting | Catalogues with varied attributes, logs, events, content, high-scale key lookups |

> [!say] "For payments and orders I want relational integrity and transactions, so SQL. For flexible product attributes or activity feeds, a document store can fit. Many systems use both."

### MongoDB: embedding vs referencing; what is the aggregation pipeline? {mid}
- **Embed** data that is read together and bounded in size (order with its line items, user with addresses).
- **Reference** data that is large, unbounded or shared (user's millions of logs, products used by many orders).
- Document limit is 16 MB.

The **aggregation pipeline** processes documents in stages: `$match → $group → $sort → $project → $lookup` (join).

```js
db.orders.aggregate([
  { $match: { status: 'paid' } },
  { $group: { _id: '$userId', total: { $sum: '$amount' } } },
  { $sort: { total: -1 } },
  { $limit: 10 },
]);
```

### What do you use Redis for? {mid, hot}
- **Cache** (query results, rendered fragments) with TTL.
- **Sessions** shared across servers.
- **Rate limiting** with `INCR` + `EXPIRE`.
- **Queues** (BullMQ, Laravel Horizon).
- **Distributed locks** (`SET key val NX PX 30000`).
- **Leaderboards** with sorted sets, counters, pub/sub for real-time.

Persistence: **RDB** snapshots and/or **AOF** log. Eviction policies like `allkeys-lru` when memory is full.

### Replication vs sharding {senior}
- **Replication**: copies of the same data on several servers. A primary takes writes; **read replicas** take reads. Improves read scaling and availability. Watch **replication lag**: read-your-own-writes may need the primary.
- **Sharding / partitioning**: split data across servers by a **shard key** (user_id, region). Scales writes and storage, but cross-shard queries and transactions get hard. Pick a key that spreads load evenly.
