---
id: laravel
title: Laravel
short: Laravel
color: #ef4444
blurb: Request lifecycle, service container, Eloquent, queues, events, auth with Sanctum, caching and the optimisation questions every Laravel interview includes.
---

## Cheatsheet
- Lifecycle: ==`public/index.php` → bootstrap app → HTTP Kernel → middleware → router → controller → response → terminate==.
- **Service container** = dependency injection; **service providers** register bindings (`register`) and boot things (`boot`).
- **Facades** are static-looking proxies to container objects (`Cache::get` → cache manager).
- Fix **N+1** with eager loading `with()`; detect with Laravel Debugbar / `preventLazyLoading()`.
- `$fillable` (allow list) vs `$guarded` (deny list) protect against **mass assignment**.
- Heavy work → **queues** (Redis + Horizon). Failed jobs → `failed_jobs`, retries, backoff.
- Production: `config:cache`, `route:cache`, `view:cache`, `optimize`, OPcache, `composer install --no-dev -o`.
- API auth: **Sanctum** (SPA / mobile tokens), **Passport** (full OAuth2).
- Use `DB::transaction()` for multi-step writes and `lockForUpdate()` to prevent race conditions.

## Architecture

### Explain the Laravel request lifecycle. {mid, hot}
1. All requests enter **`public/index.php`**, which loads Composer autoload and creates the app from `bootstrap/app.php`.
2. The **HTTP Kernel** runs bootstrappers (env, config, exception handling, facades, **service providers**).
3. Request passes through **global middleware** (maintenance mode, trim strings, CORS…).
4. **Router** matches the route, runs route/group middleware (`auth`, `throttle`).
5. **Controller** method runs (dependencies auto-injected by the container) and returns a response.
6. Response goes back out through middleware, is sent, then **terminable middleware** runs.

> [!say] "Everything goes through index.php to the kernel, service providers boot, middleware filters the request, the router dispatches to a controller, and the response travels back through the middleware."

### What is the service container and dependency injection? {mid, hot}
The **service container** is Laravel's tool for managing class dependencies. When a controller type-hints a class, the container **builds it and injects it automatically** (auto-resolution via reflection).

```php
// Bind an interface to an implementation (in a service provider)
$this->app->bind(PaymentGateway::class, RazorpayGateway::class);
$this->app->singleton(Analytics::class, fn () => new Analytics(config('services.analytics.key')));

// Controller just asks for the interface
public function __construct(private PaymentGateway $gateway) {}
```

==Benefit: you can swap implementations (Stripe ↔ Razorpay, real ↔ fake in tests) without changing the code that uses them.==

`bind` = new instance each time; `singleton` = same instance for the request lifecycle; `scoped` = singleton reset per request/job (useful with Octane).

### What are service providers? `register()` vs `boot()` {mid}
Service providers are the **central place to bootstrap** the app: bindings, event listeners, macros, route model bindings, observers.

- `register()`: **only bind things** into the container. Don't use other services here, they may not be loaded yet.
- `boot()`: runs after **all** providers are registered, so you can use any service (register observers, view composers, `Gate` rules).

Deferred providers load only when one of their services is actually needed, which speeds up boot.

### How do Facades work? {mid}
A facade is a class with a static interface that **forwards calls to an object in the container**. `Cache::get('k')` → `__callStatic` → resolves `app('cache')` → calls `get('k')` on it.

Facade vs injection: facades are convenient and still testable (`Cache::shouldReceive()`), but constructor injection makes dependencies **explicit**, which is better in large services.

### What are middleware? Give real examples. {basic, hot}
Middleware filter HTTP requests entering the app. Examples: `auth`, `verified`, `throttle:60,1`, CORS, logging request time, checking a role, forcing JSON responses, checking a tenant.

```php
class EnsureUserIsAdmin {
    public function handle(Request $request, Closure $next) {
        if (! $request->user()?->is_admin) abort(403);
        return $next($request);
    }
}
```

Before middleware acts before `$next($request)`; after middleware acts on the `$response` returned by `$next`.

## Eloquent & Database

### What is the N+1 query problem and how do you fix it? {mid, hot}
Loading a list, then running **one extra query per item** for a relation.

```php
// N+1: 1 query for posts + 1 query per post for author
foreach (Post::all() as $post) echo $post->author->name;

// Fixed: 2 queries total
foreach (Post::with('author')->get() as $post) echo $post->author->name;
```

Other tools: `load()` (lazy eager load), `withCount('comments')`, nested `with('comments.user')`, constrained eager loading.

> [!tip] Put `Model::preventLazyLoading(! app()->isProduction());` in `AppServiceProvider::boot()` so N+1 throws an exception in development.

### Mass assignment: `$fillable` vs `$guarded` {basic, hot}
Mass assignment = `User::create($request->all())`. An attacker could send `is_admin=1`.

- `$fillable = ['name', 'email']`: **only these** can be mass assigned (allow list, safer).
- `$guarded = ['is_admin']`: everything **except** these.

Best practice: use `$request->validated()` from a Form Request, and `$fillable`.

### Eloquent relationships you should know {mid, hot}
| Relation | Example |
|---|---|
| `hasOne` / `belongsTo` | User has one Profile |
| `hasMany` | Post has many Comments |
| `belongsToMany` | User ↔ Roles (pivot table `role_user`) |
| `hasManyThrough` | Country → Users → Posts |
| `morphOne` / `morphMany` | Comments on Posts **and** Videos |
| `morphToMany` | Tags on many models |

Know `withPivot()`, `withTimestamps()`, `sync()`, `attach()`, `detach()` for many-to-many.

### Accessors, mutators and casts {basic}
- **Accessor**: format a value when reading (`full_name`).
- **Mutator**: transform when setting (hash password, lowercase email).
- **Casts**: auto-convert types (`'meta' => 'array'`, `'paid_at' => 'datetime'`, enum casts, `encrypted`).

```php
protected function email(): Attribute {
    return Attribute::make(set: fn ($v) => strtolower($v));
}
protected $casts = ['settings' => 'array', 'status' => OrderStatus::class];
```

### Query scopes: local vs global {mid}
- **Local scope**: reusable query part you call explicitly: `Order::paid()->recent()->get()`.
- **Global scope**: applied to **every query** of the model automatically, e.g. multi-tenancy `where tenant_id = ?` or `SoftDeletes`. Remove with `withoutGlobalScope()`.

```php
public function scopePaid(Builder $q): void { $q->where('status', 'paid'); }
```

### How do you process a table with 1 million rows without running out of memory? {senior, hot}
Never `Model::all()`. Use:

- `chunk(1000, fn ($rows) => ...)`: pages with offset; **don't update the column you filter on** inside it.
- `chunkById(1000, ...)`: uses `where id > last_id`, ==safe while updating and faster on large tables==.
- `lazy()` / `lazyById()`: a LazyCollection that streams chunks.
- `cursor()`: one row at a time with one query (low memory, but holds the DB cursor open).
- For bulk changes, a single `update()` query or `upsert()` beats loading models.

Run it inside a **queued job** and dispatch batches for very large work.

### Transactions and row locking {senior, hot}
Use `DB::transaction()` when several writes must all succeed or all fail (order + payment + stock).

```php
DB::transaction(function () use ($productId, $qty) {
    $product = Product::whereKey($productId)->lockForUpdate()->first();
    if ($product->stock < $qty) throw new OutOfStock();
    $product->decrement('stock', $qty);
    Order::create([...]);
}, attempts: 3); // retry on deadlock
```

- `lockForUpdate()`: `SELECT … FOR UPDATE`, other transactions wait (prevents overselling).
- `sharedLock()`: others can read but not write.
- Atomic alternatives: `decrement()` with a `where('stock', '>=', $qty)` check, or `Cache::lock()` for distributed locks.

### Migrations, seeders and factories {basic}
- **Migrations**: version control for schema (`up`/`down`), run with `php artisan migrate`.
- **Seeders**: insert initial or demo data.
- **Factories**: generate fake models for tests and seeding (`User::factory()->count(10)->create()`).

> [!warn] In production never edit a migration that already ran; create a new one. For big tables, adding an index or column can lock the table, so plan zero-downtime migrations.

## Queues, Events & Jobs

### How do queues work in Laravel? {mid, hot}
Slow tasks (emails, PDFs, image resize, webhooks, payment reconciliation) are pushed as **jobs** to a queue driver (**Redis**, SQS, database). **Workers** (`php artisan queue:work`) pull and run them.

```php
ProcessInvoice::dispatch($order)->onQueue('invoices')->delay(now()->addMinute());

class ProcessInvoice implements ShouldQueue {
    public $tries = 5;
    public $backoff = [10, 60, 300];
    public $timeout = 120;
    public function handle(PdfService $pdf) { /* ... */ }
    public function failed(Throwable $e) { /* alert */ }
}
```

- **Horizon**: dashboard and config for Redis queues.
- Use **Supervisor** to keep workers running; run `queue:restart` after deploy.
- Make jobs **idempotent**: a retried job must not charge twice or send two emails.
- `ShouldBeUnique`, `WithoutOverlapping` middleware, job batching (`Bus::batch`) and chains (`Bus::chain`).

### Events and listeners vs observers {mid}
- **Events/listeners**: decouple side effects. `OrderPlaced` → `SendConfirmationEmail`, `UpdateInventory`, `NotifyAdmin`. Listeners can be queued (`ShouldQueue`).
- **Observers**: hook into **model lifecycle** events (`creating`, `created`, `updated`, `deleted`) for one model.

> [!warn] Model events don't fire on mass updates like `Order::where(...)->update([...])`, because no models are loaded.

### How does the task scheduler work? {basic}
One cron entry runs every minute: `* * * * * php artisan schedule:run`. You define tasks in code (`routes/console.php` or the Console Kernel):

```php
Schedule::command('reports:daily')->dailyAt('02:00')->onOneServer()->withoutOverlapping();
Schedule::job(new ReconcilePayments)->everyFifteenMinutes();
```

`onOneServer()` (needs a shared cache like Redis) avoids running the task on every server.

## Auth & Security

### Sanctum vs Passport vs JWT {mid, hot}
| | Use case |
|---|---|
| **Sanctum** | First-party SPA (cookie session auth) and simple **API tokens** for mobile apps. Lightweight, most common. |
| **Passport** | Full **OAuth2 server**: third-party apps, authorization code flow, scopes, client credentials. |
| **JWT package** | Stateless tokens; common in older APIs or microservices. |

==For your own SPA + mobile app, Sanctum is the usual answer.==

### Gates vs Policies {mid}
Both handle **authorization** (can this user do X?).
- **Gate**: closure for simple, non-model actions: `Gate::define('view-reports', fn ($u) => $u->is_admin)`.
- **Policy**: class grouping rules **for one model**: `PostPolicy@update`. Use `$this->authorize('update', $post)` or `@can` in Blade.

### How does Laravel protect against common attacks? {mid, hot}
- **SQL injection**: Eloquent/Query Builder use PDO prepared statements. Be careful with `DB::raw` / `whereRaw` and bind parameters.
- **XSS**: Blade `{{ }}` escapes output; `{!! !!}` does not.
- **CSRF**: `@csrf` token checked by middleware for web forms.
- **Mass assignment**: `$fillable`.
- Password hashing (`Hash::make`, bcrypt/argon2), encryption (`Crypt`), signed URLs, rate limiting (`throttle`).

## Performance & Caching

### How do you optimise a slow Laravel application? {senior, hot}
1. **Measure**: Telescope, Debugbar, Clockwork, APM, slow query log.
2. **Database**: fix N+1 with `with()`, add indexes, select only needed columns, paginate, use `chunkById`.
3. **Cache**: `Cache::remember()` for expensive queries/config, Redis as cache driver, cache tags.
4. **Queues** for slow tasks.
5. **Framework**: `php artisan optimize` (config/route/event/view cache), `composer install --optimize-autoloader --no-dev`.
6. **PHP**: OPcache enabled, PHP 8.x with JIT where useful, tune PHP-FPM workers.
7. **Octane** (Swoole/RoadRunner/FrankenPHP) keeps the app in memory between requests.
8. CDN for assets, HTTP caching, response compression.

```php
$stats = Cache::remember("dashboard:{$user->id}", now()->addMinutes(10), fn () => $this->buildStats($user));
```

### Cache invalidation strategies in Laravel {senior}
- **TTL**: simplest; accept data being stale for N minutes.
- **Event-based**: clear keys in model observers / events when data changes (`Cache::forget("product:{$id}")`).
- **Cache tags** (Redis/Memcached): `Cache::tags(['products'])->flush()`.
- **Versioned keys**: `products:v{$version}`; bump the version to invalidate all.
- Prevent **cache stampede** with `Cache::lock()` or `Cache::flexible()` (stale-while-revalidate).

### What is Laravel Octane and when would you use it? {senior}
Octane boots the app **once** and serves many requests from memory using Swoole, RoadRunner or FrankenPHP. This removes the bootstrap cost on every request and gives big throughput gains.

> [!warn] Because the app stays in memory, **static properties and singletons leak state between requests**. Avoid storing request data in singletons; use `scoped` bindings.

## Testing & Misc

### How do you test in Laravel? {mid}
- **Feature tests**: hit routes (`$this->postJson('/api/orders', [...])->assertCreated()`).
- **Unit tests**: test services/classes alone.
- `RefreshDatabase` trait, factories, SQLite in memory or a test MySQL DB.
- Fakes: `Queue::fake()`, `Mail::fake()`, `Event::fake()`, `Http::fake()`, `Storage::fake()`.
- Pest or PHPUnit.

### What are Form Requests? {basic}
Dedicated classes for **validation and authorization** of a request. They keep controllers thin.

```php
class StoreOrderRequest extends FormRequest {
    public function authorize(): bool { return $this->user()->can('create', Order::class); }
    public function rules(): array {
        return ['items' => 'required|array|min:1', 'items.*.id' => 'exists:products,id'];
    }
}
```

### What are API Resources? {basic}
Transform models into JSON consistently, hide internal fields, add computed fields, and handle collections with pagination meta.

```php
return new OrderResource($order->load('items'));
return OrderResource::collection(Order::paginate(20));
```
