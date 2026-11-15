---
id: javascript
title: JavaScript Core
short: JavaScript
color: #c9970a
blurb: The fundamentals asked in every frontend and Node round: closures, this, prototypes, hoisting, the event loop, promises and the classic output and polyfill questions.
---

## Cheatsheet
- `var` is function-scoped and hoisted as `undefined`; `let`/`const` are block-scoped and in the **temporal dead zone** until declared.
- A **closure** is a function that remembers variables from the scope where it was created.
- `this` depends on **how a function is called**; arrow functions take `this` from the surrounding scope.
- Microtasks (**Promises**) run before macrotasks (**setTimeout**).
- `==` coerces types, `===` doesn't. `null == undefined` is true; `NaN !== NaN`.
- Objects and arrays are copied **by reference**; spread is a **shallow** copy; use `structuredClone` for deep copies.
- Debounce = wait until calls stop; throttle = at most once per interval.
- `call(this, a, b)`, `apply(this, [a, b])` run now; `bind(this)` returns a new function.

## Scope & Closures

### `var` vs `let` vs `const`; what is hoisting? {basic, hot}
| | Scope | Hoisted | Re-assign | Re-declare |
|---|---|---|---|---|
| `var` | Function | Yes, as `undefined` | Yes | Yes |
| `let` | Block | Yes, but in **TDZ** | Yes | No |
| `const` | Block | Yes, but in **TDZ** | No | No |

**Hoisting**: declarations are moved to the top of their scope during compilation. Function declarations are hoisted **with their body**; function expressions are not.

> [!warn] `const` stops re-assignment, not mutation: `const arr = []; arr.push(1)` works.

### What is a closure? Give a practical use. {basic, hot}
A closure is a function **bundled with references to its outer variables**, even after the outer function has returned.

```js
function createCounter() {
  let count = 0;                 // private
  return { inc: () => ++count, get: () => count };
}
const c = createCounter();
c.inc(); c.get(); // 1
```

Uses: data privacy, function factories, memoization, debounce/throttle, event handlers, React hooks.

### Classic: `var` in a loop with `setTimeout` {mid, hot}
```js
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i)); // 3 3 3
for (let i = 0; i < 3; i++) setTimeout(() => console.log(i)); // 0 1 2
```
`var` has one shared `i` for the whole function; by the time the callbacks run, `i` is 3. `let` creates a **new binding per iteration**, so each closure captures its own value.

## this, Prototypes & Classes

### How does `this` work? {mid, hot}
Decided by the **call site**:
1. `new Fn()` → the new object.
2. `fn.call(obj)` / `apply` / `bind` → `obj`.
3. `obj.fn()` → `obj`.
4. Plain `fn()` → `undefined` in strict mode (global object otherwise).
5. **Arrow functions** have no own `this`; they use the enclosing scope's `this`.

```js
const user = {
  name: 'Asha',
  regular() { return this.name; },
  arrow: () => this?.name,
};
user.regular(); // 'Asha'
user.arrow();   // undefined, `this` is from module scope
```

### `call` vs `apply` vs `bind` {basic, hot}
- `fn.call(ctx, a, b)`: call now, args one by one.
- `fn.apply(ctx, [a, b])`: call now, args as an array.
- `fn.bind(ctx, a)`: returns a **new function** with `this` fixed (and optional preset args).

### Explain prototypal inheritance. {mid}
Every object has a hidden link `[[Prototype]]` to another object. Property lookup walks this **prototype chain** until it finds the property or reaches `null`. `class` syntax is sugar over prototypes.

```js
const animal = { speak() { return `${this.name} makes a sound`; } };
const dog = Object.create(animal);
dog.name = 'Rex';
dog.speak(); // found on the prototype
```

## Async JavaScript

### Explain the browser event loop: microtasks vs macrotasks. {mid, hot}
JS runs on one call stack. When the stack is empty:
1. Run **all microtasks** (Promise callbacks, `queueMicrotask`, MutationObserver).
2. Render if needed.
3. Take **one macrotask** (setTimeout, setInterval, I/O, UI events), then back to step 1.

```js
console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve().then(() => console.log('C'));
(async () => { console.log('D'); await null; console.log('E'); })();
console.log('F');
// A D F C E B
```

> [!tip] Code after `await` runs as a **microtask**. Code before the first `await` runs synchronously.

### Implement `Promise.all` (polyfill). {senior, hot}
```js
function promiseAll(promises) {
  return new Promise((resolve, reject) => {
    const results = [];
    let done = 0;
    if (promises.length === 0) return resolve([]);
    promises.forEach((p, i) => {
      Promise.resolve(p).then((value) => {
        results[i] = value;            // keep order
        if (++done === promises.length) resolve(results);
      }, reject);                      // fail fast
    });
  });
}
```

### Implement debounce and throttle. {mid, hot}
- **Debounce**: run only after calls **stop** for `delay` ms (search box, resize end).
- **Throttle**: run **at most once** per `interval` (scroll, mousemove, button spam).

```js
function debounce(fn, delay = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

function throttle(fn, interval = 200) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= interval) { last = now; fn.apply(this, args); }
  };
}
```

## Objects & Data

### Shallow copy vs deep copy {mid, hot}
- **Shallow** (`{...obj}`, `Object.assign`, `arr.slice()`): copies top-level only; nested objects are **shared**.
- **Deep**: `structuredClone(obj)` (modern, handles Dates, Maps, cycles). `JSON.parse(JSON.stringify(obj))` loses Dates, functions, `undefined` and fails on cycles.

```js
const a = { user: { name: 'A' } };
const b = { ...a };
b.user.name = 'B';
a.user.name; // 'B', shared nested object
```

### `map` vs `forEach` vs `filter` vs `reduce` {basic}
- `forEach`: loop for side effects, returns `undefined`.
- `map`: returns a **new array** of the same length with transformed items.
- `filter`: returns a new array of items that pass a test.
- `reduce`: folds the array into **one value** (sum, object grouping).

```js
const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
const byStatus = orders.reduce((acc, o) => ((acc[o.status] ??= []).push(o), acc), {});
```

### `==` vs `===`, `null` vs `undefined`, `??` vs `||` {basic, hot}
- `===` compares without coercion. Use it.
- `undefined`: declared but not assigned / missing property. `null`: intentionally empty.
- `a || b` falls back on **any falsy** value (`0`, `''`, `false`). `a ?? b` falls back only on `null`/`undefined`.

```js
const qty = 0;
qty || 1; // 1, probably a bug
qty ?? 1; // 0
```

### What are `Map`, `Set`, `WeakMap`? {mid}
- `Map`: key-value with **any key type**, keeps insertion order, has `size`. Better than objects for frequent add/remove.
- `Set`: unique values. `[...new Set(arr)]` removes duplicates.
- `WeakMap`: keys must be objects and are **weakly held**, so they can be garbage collected. Good for caching data tied to DOM nodes or objects without leaks.

### Event delegation and bubbling {mid}
Events **bubble** from the target up to its ancestors. **Event delegation** attaches one listener on a parent and checks `event.target`, instead of one listener per child. It works for elements added later and uses less memory.

```js
list.addEventListener('click', (e) => {
  const item = e.target.closest('li[data-id]');
  if (item) remove(item.dataset.id);
});
```
