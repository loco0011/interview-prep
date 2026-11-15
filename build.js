/*
 * Interview Playbook — build script (zero dependencies).
 *
 *   node build.js           -> builds dist/index.html (self-contained site)
 *   node build.js --watch   -> rebuilds whenever content/ or src/ changes
 *
 * Content lives in content/*.md (one file per tab, ordered by filename).
 * See README.md for the content format.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONTENT = path.join(ROOT, 'content');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/* ---------------- tiny markdown renderer ---------------- */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/==([^=]+?)==/g, '<mark>$1</mark>');
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

const CALLOUTS = {
  tip: 'Interview tip',
  say: 'Say it like this',
  warn: 'Watch out',
  key: 'Key point',
  note: 'Note',
};

function isBlockStart(l) {
  return /^```/.test(l) || /^\|/.test(l) || /^>/.test(l) || /^\s*[-*] /.test(l) || /^\d+\. /.test(l) || /^#{3,4} /.test(l);
}

function renderList(lines, i, ordered) {
  const re = ordered ? /^\d+\. / : /^[-*] /;
  const items = [];
  const start = ordered ? parseInt(lines[i], 10) : 1;
  while (i < lines.length) {
    const l = lines[i];
    if (re.test(l)) {
      items.push({ text: l.replace(re, ''), subs: [] });
    } else if (/^\s{2,}[-*] /.test(l) && items.length) {
      items[items.length - 1].subs.push(l.replace(/^\s+[-*] /, ''));
    } else if (/^\s{2,}\S/.test(l) && items.length) {
      const it = items[items.length - 1];
      if (it.subs.length) it.subs[it.subs.length - 1] += ' ' + l.trim();
      else it.text += ' ' + l.trim();
    } else break;
    i++;
  }
  const tag = ordered ? 'ol' : 'ul';
  const html =
    `<${tag}${ordered && start > 1 ? ` start="${start}"` : ''}>` +
    items
      .map(
        (it) =>
          `<li>${inline(it.text)}${it.subs.length ? '<ul>' + it.subs.map((s) => `<li>${inline(s)}</li>`).join('') + '</ul>' : ''}</li>`
      )
      .join('') +
    `</${tag}>`;
  return [html, i];
}

function md(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const lang = l.slice(3).trim() || 'text';
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(
        `<div class="code"><div class="code-bar"><span>${esc(lang)}</span><button class="copy" type="button">Copy</button></div>` +
          `<pre><code class="language-${esc(lang)}">${esc(buf.join('\n'))}</code></pre></div>`
      );
      continue;
    }
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^#{3,4} /.test(l)) {
      out.push(`<h4>${inline(l.replace(/^#+ /, ''))}</h4>`);
      i++;
      continue;
    }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) =>
        r.replace(/\\\|/g, '\u0001').replace(/^\||\|\s*$/g, '').split('|').map((c) => c.replace(/\u0001/g, '|').trim());
      const head = cells(rows[0]);
      const body = rows.slice(1).filter((r) => !/^\|[\s:|-]+\|?\s*$/.test(r));
      out.push(
        '<div class="table-wrap"><table><thead><tr>' +
          head.map((h) => `<th>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>'
      );
      continue;
    }
    if (/^>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^> ?/, ''));
      let kind = 'note';
      const m = buf[0].match(/^\[!(\w+)\]\s*/);
      if (m) {
        kind = m[1].toLowerCase();
        buf[0] = buf[0].slice(m[0].length);
      }
      out.push(
        `<div class="callout callout-${esc(kind)}"><span class="callout-label">${CALLOUTS[kind] || 'Note'}</span>${md(buf.join('\n'))}</div>`
      );
      continue;
    }
    if (/^[-*] /.test(l)) {
      const [html, ni] = renderList(lines, i, false);
      out.push(html);
      i = ni;
      continue;
    }
    if (/^\d+\. /.test(l)) {
      const [html, ni] = renderList(lines, i, true);
      out.push(html);
      i = ni;
      continue;
    }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

/* ---------------- content parser ---------------- */

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}

const plain = (html) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function parseTopic(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) throw new Error(`${path.basename(file)}: missing front matter`);
  const meta = {};
  fm[1].split('\n').forEach((line) => {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  });
  const body = raw.slice(fm[0].length);
  const chunks = body.split(/^## /m).slice(1);
  const topic = {
    id: meta.id,
    title: meta.title,
    short: meta.short || meta.title,
    color: meta.color || '#6b7cff',
    blurb: meta.blurb || '',
    cheats: [],
    sections: [],
  };
  let n = 0;
  const seen = new Set();
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n');
    const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const rest = nl === -1 ? '' : chunk.slice(nl + 1);
    if (title.toLowerCase() === 'cheatsheet') {
      topic.cheats = rest
        .split('\n')
        .filter((l) => /^- /.test(l))
        .map((l) => inline(l.slice(2)));
      continue;
    }
    const parts = rest.split(/^### /m);
    const section = { title, intro: parts[0].trim() ? md(parts[0]) : '', qs: [] };
    for (const p of parts.slice(1)) {
      const pnl = p.indexOf('\n');
      let head = (pnl === -1 ? p : p.slice(0, pnl)).trim();
      const ans = pnl === -1 ? '' : p.slice(pnl + 1);
      let tags = [];
      const tm = head.match(/\{([^}]*)\}\s*$/);
      if (tm) {
        tags = tm[1].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        head = head.slice(0, tm.index).trim();
      }
      const level = ['basic', 'mid', 'senior'].find((l) => tags.includes(l)) || 'mid';
      let id = `${topic.id}-${hash(head)}`;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      const html = md(ans);
      n++;
      section.qs.push({ id, n, q: head, qh: inline(head), level, hot: tags.includes('hot'), a: html, t: plain(html).toLowerCase() });
    }
    topic.sections.push(section);
  }
  topic.count = n;
  return topic;
}

/* ---------------- build ---------------- */

function build() {
  const t0 = Date.now();
  const files = fs.readdirSync(CONTENT).filter((f) => f.endsWith('.md')).sort();
  const topics = files.map((f) => parseTopic(path.join(CONTENT, f)));
  const data = { built: new Date().toISOString().slice(0, 10), topics };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

  const tpl = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');

  const fragment = tpl
    .replace('/*__STYLES__*/', () => css)
    .replace('/*__DATA__*/', () => `window.PLAYBOOK = ${json};`)
    .replace('/*__APP__*/', () => js);

  fs.mkdirSync(DIST, { recursive: true });
  // Full standalone page — open directly or host anywhere (Netlify, Vercel, GitHub Pages).
  fs.writeFileSync(
    path.join(DIST, 'index.html'),
    `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${fragment}\n</html>\n`
  );
  // Fragment version — used when publishing as a claude.ai artifact (it adds its own skeleton).
  fs.writeFileSync(path.join(DIST, 'artifact.html'), fragment);

  const total = topics.reduce((s, t) => s + t.count, 0);
  console.log(`Built ${topics.length} topics, ${total} questions in ${Date.now() - t0}ms -> dist/index.html`);
}

build();

if (process.argv.includes('--watch')) {
  let timer;
  const again = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { build(); } catch (e) { console.error(e.message); }
    }, 120);
  };
  fs.watch(CONTENT, again);
  fs.watch(SRC, again);
  console.log('Watching content/ and src/ ...');
}
