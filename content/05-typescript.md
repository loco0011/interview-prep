---
id: typescript
title: TypeScript
short: TypeScript
color: #3178c6
blurb: Types vs interfaces, generics, narrowing, utility types, unknown vs any, typing React and APIs, and the tsconfig settings that matter.
---

## Cheatsheet
- TypeScript is **compile-time only**; types are erased, so validate API data at runtime (zod).
- `interface` can be **merged and extended**; `type` can describe **unions, tuples, mapped and conditional** types.
- ==`unknown` is the safe `any`==: you must narrow it before use.
- `never` = a value that can't exist; use it for **exhaustive checks** in `switch`.
- Narrowing: `typeof`, `instanceof`, `in`, equality, **discriminated unions**, custom type guards `x is T`.
- Utility types: `Partial`, `Required`, `Readonly`, `Pick`, `Omit`, `Record`, `ReturnType`, `Parameters`, `Awaited`, `NonNullable`.
- Generics = type parameters; constrain with `extends`.
- Turn on `"strict": true`; it enables `strictNullChecks`, `noImplicitAny` and more.
- `satisfies` checks a value against a type **without widening** its inferred type.

## Basics

### Why TypeScript? What are its benefits? {basic, hot}
TypeScript is **JavaScript with static types**, compiled to plain JS.
- Catches bugs **at compile time** (typos, wrong argument types, null access).
- Better **autocomplete and refactoring** in editors.
- Types act as **documentation** and contracts between frontend and backend.
- Safer large-scale refactors in big teams.

> [!warn] Types disappear at runtime. Data from an API, form or `JSON.parse` is not checked automatically; validate it with zod, valibot or similar.

### `type` vs `interface` {basic, hot}
| | `interface` | `type` |
|---|---|---|
| Objects | Yes | Yes |
| Unions / tuples / primitives | No | Yes |
| Extend | `extends` | Intersection `&` |
| Declaration merging | **Yes** (same name merges) | No (duplicate error) |
| Mapped / conditional types | No | Yes |

==Common rule: `interface` for object shapes and public APIs (extendable), `type` for unions, function types and complex compositions.== Teams mainly just stay consistent.

### `any` vs `unknown` vs `never` vs `void` {mid, hot}
- `any`: turns type checking **off**. Avoid it.
- `unknown`: "could be anything", but you must **narrow** it before using it. Use for `catch (e)` and external input.
- `never`: no value can have this type: functions that always throw, impossible branches.
- `void`: function returns nothing useful.

```ts
function handle(e: unknown) {
  if (e instanceof Error) console.log(e.message); // OK after narrowing
}
```

### What is type inference? {basic}
TS works out types when you don't write them: `let n = 5` is `number`; a function's return type is inferred from its `return`. Annotate **function parameters and public APIs**; let inference do local variables.

## Advanced Types

### What are generics? Give a real example. {mid, hot}
Generics let a function, class or type work with **many types while keeping type safety**: a "type parameter".

```ts
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
const users = await fetchJson<User[]>('/api/users'); // users: User[]

// Constraint
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }

// Generic API response
interface ApiResponse<T> { data: T; meta?: { page: number; total: number } }
```

### What is type narrowing and what are type guards? {mid, hot}
**Narrowing** = TS refines a broad type to a specific one inside a branch.

- `typeof x === 'string'`
- `x instanceof Date`
- `'email' in user`
- Equality / truthiness checks
- **Custom type guard** with `is`:

```ts
function isAdmin(u: User | Admin): u is Admin {
  return (u as Admin).permissions !== undefined;
}
```

### What are discriminated unions? Why are they useful? {senior, hot}
A union where every member has a common **literal field** (the discriminant). TS narrows by checking it, and `never` gives **exhaustive checking**.

```ts
type PaymentState =
  | { status: 'idle' }
  | { status: 'processing'; orderId: string }
  | { status: 'success'; paymentId: string }
  | { status: 'failed'; error: string };

function render(s: PaymentState) {
  switch (s.status) {
    case 'idle': return 'Pay now';
    case 'processing': return `Processing ${s.orderId}`;
    case 'success': return `Paid: ${s.paymentId}`;
    case 'failed': return s.error;
    default: { const _exhaustive: never = s; return _exhaustive; } // compile error if a case is missing
  }
}
```

==This makes impossible states impossible==, e.g. you can't have `paymentId` while still `processing`.

### Explain the common utility types. {mid, hot}
| Utility | Does |
|---|---|
| `Partial<T>` | All props optional (PATCH bodies) |
| `Required<T>` | All props required |
| `Readonly<T>` | All props readonly |
| `Pick<T, 'a' \| 'b'>` | Keep some props |
| `Omit<T, 'password'>` | Remove some props |
| `Record<K, V>` | Object with keys K and values V |
| `ReturnType<typeof fn>` | Return type of a function |
| `Parameters<typeof fn>` | Tuple of parameter types |
| `Awaited<T>` | Unwrap a Promise type |
| `NonNullable<T>` | Remove `null` / `undefined` |
| `Exclude` / `Extract` | Filter union members |

```ts
type PublicUser = Omit<User, 'password' | 'otpSecret'>;
type UpdateUserDto = Partial<Pick<User, 'name' | 'phone'>>;
```

### What are mapped and conditional types? {senior}
**Mapped types** build a new type by looping over keys; **conditional types** choose a type with `T extends U ? X : Y`.

```ts
type Nullable<T> = { [K in keyof T]: T[K] | null };
type ApiResult<T> = T extends Error ? { ok: false; error: T } : { ok: true; data: T };
type ElementOf<T> = T extends (infer U)[] ? U : never;   // infer pulls out a type
```

### `keyof`, `typeof` and indexed access types {mid}
- `keyof User` → union of keys `'id' | 'name' | ...`
- `typeof config` → the type of a value
- `User['address']` → type of one property

```ts
const ROLES = ['admin', 'editor', 'viewer'] as const;
type Role = typeof ROLES[number]; // 'admin' | 'editor' | 'viewer'
```

### What does `satisfies` do? {senior}
Checks that a value matches a type **but keeps the narrower inferred type**, unlike an annotation which widens it.

```ts
const routes = { home: '/', profile: '/me' } satisfies Record<string, string>;
routes.home; // still known as a key; typos like routes.hom are errors
```

## In Practice

### How do you type React components and hooks? {mid, hot}
```tsx
type ButtonProps = {
  variant?: 'primary' | 'ghost';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
} & React.ComponentPropsWithoutRef<'button'>;

export function Button({ variant = 'primary', ...rest }: ButtonProps) {
  return <button className={variant} {...rest} />;
}

const [user, setUser] = useState<User | null>(null);
const inputRef = useRef<HTMLInputElement>(null);

function List<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  return <ul>{items.map(render)}</ul>;
}
```

### How do you keep frontend and backend types in sync? {senior}
- **Shared package** in a monorepo (`packages/types`).
- Generate types from an **OpenAPI/Swagger** spec (`openapi-typescript`).
- **zod schemas** as the single source: `type User = z.infer<typeof UserSchema>`, and validate at runtime too.
- End-to-end typed APIs: **tRPC**, GraphQL codegen.

### Important `tsconfig` options {mid}
- `strict: true` (always), `noUncheckedIndexedAccess` (array access may be undefined).
- `target` / `module` / `moduleResolution` (`bundler` or `nodenext`).
- `paths` + `baseUrl` for import aliases (`@/components`).
- `esModuleInterop`, `skipLibCheck`, `isolatedModules` (needed by Vite/SWC/esbuild).

### What are declaration files (`.d.ts`)? {mid}
Files that contain **only types** for JavaScript code, so TS knows the shape of a JS library. Install from DefinitelyTyped (`npm i -D @types/express`) or write your own; extend global types with **declaration merging**:

```ts
// types/express.d.ts
declare global {
  namespace Express { interface Request { user?: { id: string; role: Role } } }
}
export {};
```

### Enums vs union of string literals {mid}
TS `enum` generates runtime JS code and has some quirks (numeric enums accept any number). Many teams prefer **string literal unions** or `as const` objects, which are erased at compile time and work with narrowing.

```ts
const Status = { Pending: 'pending', Paid: 'paid' } as const;
type Status = typeof Status[keyof typeof Status]; // 'pending' | 'paid'
```
