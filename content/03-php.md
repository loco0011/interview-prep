---
id: php
title: PHP
short: PHP
color: #7b7fc4
blurb: Core PHP, OOP, SOLID, PHP 8 features, sessions, security, Composer and how PHP-FPM actually serves a request.
---

## Cheatsheet
- `==` compares after type juggling; ==`===` compares value **and** type==. In PHP 8, `0 == "abc"` is **false**.
- Interface = contract only; abstract class = partial implementation; trait = **copy-paste reuse** of methods.
- PHP 8: **named args, union types, match, nullsafe `?->`, constructor promotion, enums (8.1), readonly (8.1), JIT**.
- `include` warns and continues; `require` is fatal on failure; `_once` versions load only once.
- Sessions: data on the **server**, ID in a cookie. Cookies: data in the **browser**.
- Security: prepared statements (PDO), `htmlspecialchars` on output, `password_hash`, CSRF tokens.
- PHP is **shared-nothing**: each request starts fresh; PHP-FPM keeps a pool of worker processes.
- **OPcache** stores compiled bytecode so scripts aren't recompiled on every request.
- Composer: `composer.lock` pins exact versions; PSR-4 autoloading maps namespaces to folders.

## Core PHP

### `==` vs `===` in PHP {basic, hot}
- `==` (loose): converts types before comparing. `"1" == 1` is true, `null == false` is true.
- `===` (strict): value **and** type must match. `"1" === 1` is false.

PHP 8 changed string-to-number comparison: `0 == "abc"` is now **false** (it was true in PHP 7).

> [!tip] Always prefer `===`, and use `in_array($x, $arr, true)` for strict checks. Loose comparison bugs are a classic security issue (e.g. `"0e123" == "0e456"` is true because both look like 0 in scientific notation).

### `include` vs `require` vs `include_once` vs `require_once` {basic}
| | File missing | Loads twice? |
|---|---|---|
| `include` | Warning, script continues | Yes |
| `require` | **Fatal error**, script stops | Yes |
| `include_once` / `require_once` | Same as above | No, only once |

In modern PHP you rarely use these directly; **Composer autoloading** loads classes.

### Sessions vs cookies {basic, hot}
- **Cookie**: small data stored **in the browser**, sent with every request. The user can read and edit it.
- **Session**: data stored **on the server** (files, Redis, DB). Only a **session ID** goes in a cookie.

Secure session setup: `session_regenerate_id(true)` after login (prevents session fixation), cookie flags `HttpOnly`, `Secure`, `SameSite=Lax`. With multiple servers, store sessions in **Redis** so any server can read them.

### What are superglobals? {basic}
Built-in arrays available everywhere: `$_GET`, `$_POST`, `$_REQUEST`, `$_SERVER`, `$_SESSION`, `$_COOKIE`, `$_FILES`, `$_ENV`, `$GLOBALS`.

> [!warn] Never trust them. Validate and sanitize every value from `$_GET`, `$_POST`, `$_COOKIE` and `$_FILES`.

### How does PHP handle a request (PHP-FPM, Nginx, OPcache)? {mid, hot}
1. **Nginx** receives the request; static files are served directly.
2. `.php` requests go to **PHP-FPM** over FastCGI.
3. FPM picks a free **worker process** from its pool (`pm = dynamic`, `pm.max_children`).
4. The worker compiles the script to opcodes (or takes them from **OPcache**), runs it, returns the output.
5. ==Memory is cleared after the request (shared-nothing architecture).==

Tuning: `pm.max_children ≈ available RAM / average worker memory`. Too low → requests queue (502/504); too high → server swaps.

### Pass by value vs pass by reference {basic}
By default variables are **passed by value** (a copy). Use `&` to pass by reference. Objects are passed as a **handle**: the function can change the object's properties, but reassigning the parameter doesn't affect the caller.

```php
function addOne(int &$n) { $n++; }
$x = 1; addOne($x); // $x = 2
```

## OOP

### Abstract class vs interface vs trait {mid, hot}
| | Abstract class | Interface | Trait |
|---|---|---|---|
| Purpose | Base with shared code | Contract | Reuse methods horizontally |
| Methods | Abstract + concrete | Signatures only (+ constants) | Concrete (can be abstract) |
| Properties | Yes | No | Yes |
| Multiple? | Extend **one** | Implement **many** | Use **many** |

```php
interface PaymentGateway { public function charge(int $amountPaise): Payment; }
abstract class BaseGateway implements PaymentGateway {
    protected function log(string $m): void { /* shared */ }
}
trait HasUuid { public static function bootHasUuid() { /* ... */ } }
```

> [!say] "Interface when different classes must follow the same contract; abstract class when they also share code; trait to reuse code across unrelated classes."

### Explain the four pillars of OOP with PHP examples. {basic, hot}
- **Encapsulation**: hide internal state with `private`/`protected`; expose methods (`$account->deposit(100)` instead of touching `$balance`).
- **Abstraction**: expose **what** something does, hide **how** (`PaymentGateway::charge()`).
- **Inheritance**: `class Admin extends User` reuses and extends behaviour.
- **Polymorphism**: same interface, different behaviour; code calls `$gateway->charge()` whether it's Stripe or Razorpay.

### Explain SOLID principles. {mid, hot}
1. **S**ingle Responsibility: a class has one reason to change (controller doesn't send emails and build PDFs).
2. **O**pen/Closed: open for extension, closed for modification (add a new gateway class instead of a new `if`).
3. **L**iskov Substitution: subclasses must work wherever the parent works.
4. **I**nterface Segregation: many small interfaces beat one big one.
5. **D**ependency Inversion: depend on **abstractions** (interfaces), not concrete classes; inject dependencies.

> [!tip] Interviewers love a real example. "We had a `PaymentService` with a giant switch per gateway. I refactored it to a `PaymentGateway` interface with one class per provider, resolved through the container. Adding PayU took one new class."

### Static vs self vs `$this`; what is late static binding? {mid}
- `$this`: the current **object**.
- `self::`: the class where the code is **written**.
- `static::`: the class that was **actually called** at runtime (late static binding).

```php
class Model { public static function create() { return new static(); } }
class User extends Model {}
User::create(); // returns User (with `new self()` it would return Model)
```

### What are magic methods? {mid}
Special methods PHP calls automatically: `__construct`, `__destruct`, `__get`, `__set`, `__isset`, `__unset`, `__call`, `__callStatic`, `__toString`, `__invoke`, `__clone`, `__serialize`/`__unserialize`.

Laravel uses them a lot: Eloquent attributes use `__get`/`__set`, facades use `__callStatic`, dynamic `where` clauses use `__call`.

## Modern PHP (8.x)

### What's new in PHP 8.0–8.3? {mid, hot}
- **8.0**: JIT, named arguments, union types, `match` expression, nullsafe `?->`, constructor property promotion, attributes, `str_contains`, throw as expression.
- **8.1**: **enums**, **readonly properties**, fibers, `never` return type, first-class callable syntax `strlen(...)`, pure intersection types.
- **8.2**: readonly classes, DNF types, deprecated dynamic properties, `true`/`false`/`null` standalone types.
- **8.3**: typed class constants, `json_validate()`, `#[\Override]` attribute.
- **8.4**: property hooks, asymmetric visibility, `new` without parentheses in chains.

```php
enum OrderStatus: string { case Pending = 'pending'; case Paid = 'paid'; }

final class Money {
    public function __construct(public readonly int $amount, public readonly string $currency = 'INR') {}
}

$label = match ($status) {
    OrderStatus::Paid => 'Paid',
    OrderStatus::Pending => 'Waiting',
};
$city = $user?->address?->city;
```

### `match` vs `switch` {basic}
`match` is an **expression** (returns a value), uses **strict comparison** (`===`), has **no fall-through**, and throws `UnhandledMatchError` if nothing matches. `switch` uses loose comparison and needs `break`.

### What are generators and `yield`? {mid}
A generator returns values **one at a time** without building the whole array in memory. Ideal for large files or DB exports.

```php
function readLines(string $file): Generator {
    $h = fopen($file, 'r');
    while (($line = fgets($h)) !== false) yield $line;
    fclose($h);
}
foreach (readLines('10gb.csv') as $line) { /* constant memory */ }
```

### Error handling: exceptions vs errors in PHP 7+ {mid}
Since PHP 7, most fatal errors are thrown as `Error`. Both `Error` and `Exception` implement `Throwable`.

```php
try { riskyCall(); }
catch (PaymentException $e) { /* domain error */ }
catch (Throwable $e) { report($e); }
finally { /* cleanup */ }
```

Create **domain exceptions** (`InsufficientBalanceException`) instead of generic ones; log with context; never show raw errors to users (`display_errors=Off` in production).

## Security

### How do you prevent SQL injection in PHP? {basic, hot}
Use **prepared statements with bound parameters** (PDO or MySQLi). Never concatenate user input into SQL.

```php
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
$stmt->execute([$email]);
```

For dynamic column names or sort order (which can't be bound), use an **allow list**: `in_array($sort, ['name', 'created_at'], true)`.

### How do you prevent XSS and CSRF? {mid, hot}
**XSS** (attacker's script runs in a victim's browser): escape output with `htmlspecialchars($v, ENT_QUOTES, 'UTF-8')` (Blade/Twig do it automatically), add a **Content-Security-Policy**, set cookies `HttpOnly`.

**CSRF** (victim's browser is tricked into sending a request): use a **random token** per session in forms and check it on POST; `SameSite` cookies; check the `Origin` header.

### How should passwords be stored? {basic, hot}
Use `password_hash($password, PASSWORD_DEFAULT)` (bcrypt, or `PASSWORD_ARGON2ID`) and `password_verify()`. It adds a **unique salt** automatically and is slow on purpose.

> [!warn] Never use `md5`, `sha1` or plain `sha256` for passwords; they are too fast to brute-force. Never encrypt passwords (encryption can be reversed).

### How do you secure file uploads? {mid}
- Validate **MIME type from content** (`finfo`), not just the extension; limit size.
- Rename files (random name), store **outside the web root** or in S3.
- Never execute uploaded files; disable PHP execution in the upload folder.
- Scan for malware if needed; serve through signed URLs.

## Composer & Standards

### What is Composer? `composer.json` vs `composer.lock` {basic, hot}
Composer is PHP's **dependency manager** and autoloader.
- `composer.json`: the packages you want, with version **ranges** (`^10.0`).
- `composer.lock`: the **exact** versions installed. Commit it so every machine and server gets the same versions.
- `composer install` reads the lock file (use in CI/production); `composer update` resolves new versions and rewrites the lock.

Production: `composer install --no-dev --optimize-autoloader`.

### What is PSR? Which ones matter? {mid}
PHP Standards Recommendations from PHP-FIG:
- **PSR-1/PSR-12**: coding style.
- **PSR-4**: autoloading (namespace → folder).
- **PSR-3**: logger interface. **PSR-7**: HTTP messages. **PSR-11**: container interface. **PSR-15**: HTTP middleware.
