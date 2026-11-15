# Interview Playbook

A fast, mobile-friendly site of interview questions and answers for full-stack roles:
Node.js, Laravel, PHP, React, TypeScript, JavaScript, DevOps, payment gateways,
scenario-based, performance, databases and system design.

No framework and no dependencies: content is Markdown, `build.js` turns it into one
self-contained `dist/index.html` you can open directly or host anywhere.

## Commands

```bash
npm run build   # build dist/index.html
npm run dev     # rebuild automatically while you edit content/ or src/
npm run serve   # preview dist/ on a local server
```

## Project layout

```
content/          one Markdown file per tab (file name order = tab order)
src/index.html    page markup (template)
src/styles.css    all styles, light + dark theme tokens at the top
src/app.js        tabs, search, filters, progress, quiz mode
build.js          Markdown → HTML, bundles everything into dist/
dist/index.html   the site (deploy this)
```

## Adding questions

Open the topic file in `content/` and add a question under any `## Section`:

```md
### Your question here? {mid, hot}
Answer in Markdown.

- bullets, **bold**, `code`
- ==yellow highlight== for the line you must remember
```

Tags in `{ }` at the end of the question line:

| Tag | Meaning |
|---|---|
| `basic` / `mid` / `senior` | Level (default `mid`) |
| `hot` | Shows the red "Asked often" chip |

Callout boxes (start lines with `>`):

```md
> [!tip] Interview tip text
> [!say] A model answer to say out loud
> [!warn] A common mistake
> [!key] A key point
```

Code blocks use fences with a language (`js`, `php`, `ts`, `sql`, `bash`, `yaml`, `nginx`, `dockerfile`).
Tables use the usual `| a | b |` syntax (write `\|` for a literal pipe inside a cell).

The special section `## Cheatsheet` becomes the "Quick revision" box at the top of the tab.

## Adding a new tab

Create `content/13-something.md` with front matter:

```md
---
id: graphql
title: GraphQL
short: GraphQL
color: #e535ab
blurb: One line shown on the overview card and topic header.
---

## Cheatsheet
- ...

## Section name

### First question {basic}
...
```

## Deploying

`dist/index.html` is a single static file. Any static host works:

- **Netlify / Vercel**: build command `node build.js`, publish directory `dist`.
- **GitHub Pages**: commit `dist/` or use an Action that runs `node build.js`.

Progress ("Mark as learned"), theme and filters are saved in the browser's localStorage.
