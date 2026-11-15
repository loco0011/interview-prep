---
id: react
title: React
short: React
color: #0ea5c6
blurb: Rendering and reconciliation, hooks in depth, state management, performance, data fetching, Next.js basics and the machine-coding questions you will meet.
---

## Cheatsheet
- React re-renders a component when **its state changes, its parent re-renders, or a context it uses changes**. Props changing alone is not the trigger; the parent re-rendering is.
- **Reconciliation**: React diffs the new element tree with the old one and updates only what changed. **Keys** identify list items.
- Never use **array index as key** for lists that can reorder, insert or delete.
- `useEffect` runs **after paint**; `useLayoutEffect` runs **before paint** (measure DOM).
- `useMemo` caches a **value**, `useCallback` caches a **function**, `React.memo` skips re-rendering a **component** when props are equal.
- State updates are **batched** and **async**; use the updater form `setCount(c => c + 1)` when the next value depends on the previous one.
- Server state (API data) → **React Query / SWR**. Client/UI state → useState, Context, Zustand, Redux Toolkit.
- Effects need **cleanup** for subscriptions, timers, and aborting fetches (`AbortController`).
- Performance: code splitting (`lazy` + `Suspense`), list virtualization, memoization, avoid huge contexts.

## Fundamentals

### What is the Virtual DOM and how does reconciliation work? {basic, hot}
The **Virtual DOM** is a lightweight JS object tree describing the UI. On every render React builds a new tree, **diffs** it against the previous one (reconciliation), and applies the **minimum set of real DOM changes**.

Diffing rules (O(n) heuristics):
- Different element **type** (`div` → `span`, `A` → `B`) → destroy and rebuild that subtree (state is lost).
- Same type → keep the DOM node, update changed attributes, recurse into children.
- Lists use **keys** to match items between renders.

**React Fiber** (React 16+) splits rendering into units of work so React can pause, prioritise and resume it, which powers concurrent features like `useTransition`.

### Why do keys matter? Why not use the index? {basic, hot}
Keys tell React **which item is which** between renders. With the index as key, inserting at the top shifts every key, so React **reuses the wrong component instances**. Symptoms: input values or checkbox state jump to the wrong row, animations break, extra re-renders.

==Use a stable, unique ID from the data== (`item.id`). Index is only acceptable for static lists that never reorder.

### When does a React component re-render? {mid, hot}
1. Its **state** changes (`setState` with a new value).
2. Its **parent re-renders** (by default all children re-render, even with the same props).
3. A **context** it consumes changes.
4. A custom hook it uses triggers a state change.

> [!key] "Props changed" is not the real reason; a child re-renders because its parent rendered. `React.memo` is what makes props comparison matter.

### Controlled vs uncontrolled components {basic}
- **Controlled**: React state is the source of truth (`value` + `onChange`). Easy validation and conditional UI.
- **Uncontrolled**: the DOM keeps the value; read it with a `ref`. Less re-rendering; used by React Hook Form for performance.

### Props vs state; what is "lifting state up"? {basic}
- **Props**: read-only inputs passed from parent.
- **State**: data owned and changed by the component.

When two siblings need the same data, **lift the state up** to their closest common parent and pass it down as props. If the drilling goes too deep, use context or a store.

## Hooks

### Explain `useEffect` and its dependency array. {mid, hot}
`useEffect` runs **side effects after render** (data fetching, subscriptions, timers, DOM APIs).

| Deps | Runs |
|---|---|
| none | after **every** render |
| `[]` | once after mount (twice in dev StrictMode) |
| `[a, b]` | after mount and whenever `a` or `b` changes |

The function you return is the **cleanup**, run before the next effect and on unmount.

```jsx
useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/users/${id}`, { signal: controller.signal })
    .then(r => r.json()).then(setUser)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });
  return () => controller.abort(); // prevents race conditions & updates after unmount
}, [id]);
```

> [!tip] Mention why StrictMode runs effects twice in development: to expose missing cleanups.

### `useMemo` vs `useCallback` vs `React.memo` {mid, hot}
- `useMemo(() => compute(a), [a])`: caches a **computed value**.
- `useCallback(fn, [deps])`: caches a **function reference** (same as `useMemo(() => fn, deps)`).
- `React.memo(Component)`: skips re-render if props are shallowly equal.

They work **together**: passing an inline function to a `React.memo` child breaks the memo because the function is new each render, so wrap it in `useCallback`.

> [!warn] Don't memoize everything. Memoization has a cost; use it for expensive calculations, large lists, or props to memoized children. Measure with the React Profiler first. (The React Compiler can add memoization automatically.)

### `useRef`: what is it used for? {basic}
A mutable box (`ref.current`) that **persists across renders without causing a re-render**.
- Access DOM nodes (focus an input, measure size).
- Store values like timer IDs, previous values, latest callback, "is mounted" flags.

### `useState` vs `useReducer` {mid}
Use `useReducer` when state is **complex** (many related fields), the next state depends on the previous, or you want state transitions in one testable function (cart, multi-step form).

```jsx
function cartReducer(state, action) {
  switch (action.type) {
    case 'add': return { ...state, items: [...state.items, action.item] };
    case 'remove': return { ...state, items: state.items.filter(i => i.id !== action.id) };
    default: return state;
  }
}
const [cart, dispatch] = useReducer(cartReducer, { items: [] });
```

### What are custom hooks? Write one. {mid, hot}
A function starting with `use` that **reuses stateful logic** between components. Each component using it gets its own state.

```jsx
function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
// usage: search box that calls the API only after the user stops typing
const q = useDebounce(search);
useEffect(() => { if (q) fetchResults(q); }, [q]);
```

### Rules of hooks; why do they exist? {basic}
1. Call hooks **only at the top level**, never in loops, conditions or nested functions.
2. Call them only from **React function components or custom hooks**.

React stores hook state in a **list ordered by call position**. If the order changes between renders, state gets attached to the wrong hook.

### What is a stale closure? {senior}
A function captures variables from the render it was created in. If it runs later (interval, event listener, effect with missing deps), it sees **old values**.

```jsx
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000); // always uses count from first render
  return () => clearInterval(id);
}, []);
// Fix: setCount(c => c + 1)  or include count in deps  or keep latest value in a ref
```

## State Management

### Context API vs Redux vs Zustand vs React Query {mid, hot}
| Tool | Best for |
|---|---|
| **Context** | Rarely-changing global values: theme, auth user, locale. Every consumer re-renders when the value changes. |
| **Redux Toolkit** | Large apps, complex shared client state, devtools, strict patterns. |
| **Zustand** | Simple global store with selectors; minimal boilerplate. |
| **React Query / SWR** | **Server state**: caching, refetching, deduping, retries, pagination. |

> [!say] "I separate server state from client state. API data goes in React Query; UI state like modals and filters stays local or in a small Zustand store. Context is for things that rarely change."

### Why can Context cause performance problems? {senior}
When the provider's `value` changes, **every consumer re-renders**. If you pass a new object each render (`value={{ user, setUser }}`), all consumers re-render on every parent render.

Fixes: memoize the value with `useMemo`, **split contexts** (state vs dispatch, or by domain), keep fast-changing values out of context, or use a store with selectors (Zustand, Redux).

## Performance

### How do you optimise a slow React app? {senior, hot}
1. **Measure**: React DevTools Profiler, Lighthouse, Web Vitals (LCP, INP, CLS).
2. **Reduce bundle**: code splitting with `React.lazy` + `Suspense`, route-based splitting, tree-shaking, remove heavy libraries (moment → date-fns/dayjs).
3. **Avoid needless re-renders**: move state down, `React.memo`, `useMemo`/`useCallback`, split contexts.
4. **Virtualize long lists** (`react-window`, TanStack Virtual) instead of rendering 10,000 rows.
5. **Debounce/throttle** search inputs and scroll handlers.
6. Images: lazy loading, proper sizes, modern formats (WebP/AVIF).
7. `useTransition` / `useDeferredValue` to keep typing smooth during heavy updates.
8. Server-side rendering / static generation for faster first paint (Next.js).

### What are `useTransition` and `useDeferredValue`? {senior}
Concurrent React features to keep the UI responsive.
- `useTransition`: mark a state update as **non-urgent**; urgent updates (typing) are not blocked. Gives an `isPending` flag.
- `useDeferredValue`: get a **lagging copy** of a value, so expensive children render with the old value while the input stays snappy.

```jsx
const [isPending, startTransition] = useTransition();
const onChange = (e) => {
  setQuery(e.target.value);                         // urgent
  startTransition(() => setFiltered(filter(e.target.value))); // can wait
};
```

## Patterns & Ecosystem

### What are error boundaries? {mid}
Class components with `componentDidCatch` / `getDerivedStateFromError` that **catch render errors in their child tree** and show a fallback UI instead of a blank page.

They do **not** catch errors in event handlers, async code (`setTimeout`, promises) or SSR; handle those with try/catch. Libraries: `react-error-boundary`.

### HOC vs render props vs custom hooks {mid}
All share logic between components. **Custom hooks** replaced most HOC and render-prop use because they don't add wrapper components and are easier to compose. HOCs still appear for cross-cutting concerns (`withAuth`, `connect` in old Redux).

### CSR vs SSR vs SSG vs ISR (Next.js) {mid, hot}
| | How | Good for |
|---|---|---|
| **CSR** | Browser downloads JS, renders | Dashboards behind login |
| **SSR** | Server renders HTML per request | SEO + fresh data (product pages) |
| **SSG** | HTML built at build time | Blogs, docs, marketing |
| **ISR** | SSG + regenerate after N seconds | Large catalogues |

**React Server Components** (Next.js App Router) render on the server and send no JS for those components; use `'use client'` only for interactive parts.

### How do you handle authentication in a React SPA? {mid, hot}
- Store tokens in an **httpOnly, Secure cookie** (safe from XSS) rather than localStorage.
- Keep the user in context/store; protect routes with a wrapper (`<RequireAuth>`) that redirects to login.
- Axios/fetch interceptor: on **401**, call the refresh endpoint once, retry the original request, and queue other requests while refreshing.
- Remember the frontend check is only UX. ==The API must authorize every request.==

### Machine coding: what do interviewers usually ask? {mid, hot}
Common 45–60 minute tasks:
- Debounced **search with autocomplete** (cancel stale requests).
- **Infinite scroll** / pagination with IntersectionObserver.
- Todo app with filters and localStorage.
- **Star rating**, accordion, tabs, modal, carousel.
- Form with validation, OTP input.
- Nested comments / file explorer (recursion).
- Countdown timer / stopwatch (cleanup of intervals).

> [!tip] Talk while coding: state shape first, then components, then edge cases (empty, loading, error, rapid clicks). Write a custom hook if logic repeats.
