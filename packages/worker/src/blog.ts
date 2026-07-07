import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "./types.js";
import { BLOG_POSTS, getPost, postLastmod, sortedPosts, type BlogPost } from "./blog-posts.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/blog", (c) => {
  return c.html(blogIndexHTML());
});

app.get("/blog/:slug", (c) => {
  const post = getPost(c.req.param("slug"));
  if (!post) return c.html(blogNotFoundHTML(), 404);
  return c.html(blogPostHTML(post));
});

const BLOG_CSS = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #1a1816; --text: #e8e4de; --title: #f1ede7; --muted: #8a8480;
      --faint: #5a5550; --line: #332f2b; --brand: #d4935e; --link: #7ab7c6;
      --success: #63b486; --panel: #201e1c;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh;
      -webkit-font-smoothing: antialiased; line-height: 1.7;
    }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
      background: var(--panel); padding: 2px 6px; border-radius: 4px;
      font-size: 14px;
    }
    pre {
      background: var(--panel); border-radius: 8px; padding: 16px 20px;
      overflow-x: auto; margin: 24px 0; border: 1px solid var(--line);
    }
    pre code { background: none; padding: 0; font-size: 14px; line-height: 1.6; }

    .wrap { max-width: 640px; margin: 0 auto; padding: 0 24px; }

    .brand {
      display: flex; align-items: center; gap: 8px;
      padding-top: 24px; text-decoration: none;
    }
    .brand img { border-radius: 6px; }
    .brand span { font-size: 16px; font-weight: 600; color: var(--muted); letter-spacing: -0.3px; }
    .brand:hover span { color: var(--text); }

    .post { padding: 48px 0 64px; }
    .post-meta { color: var(--faint); font-size: 14px; margin-bottom: 8px; }
    .post h1 {
      font-size: 32px; font-weight: 700; letter-spacing: -0.5px;
      line-height: 1.2; color: var(--title); margin-bottom: 32px;
    }
    .post h2 {
      font-size: 20px; font-weight: 600; color: var(--title);
      margin: 40px 0 16px; letter-spacing: -0.3px;
    }
    .post h3 {
      font-size: 16px; font-weight: 600; color: var(--title);
      margin: 28px 0 12px;
    }
    .post p { margin-bottom: 16px; color: var(--text); font-size: 16px; }
    .post p.dim { color: var(--muted); }
    .post ul, .post ol { margin: 16px 0; padding-left: 24px; }
    .post li { margin-bottom: 8px; font-size: 16px; }
    .post blockquote {
      border-left: 3px solid var(--brand); padding: 12px 20px;
      margin: 24px 0; color: var(--muted); font-style: italic;
    }
    .post hr {
      border: none; border-top: 1px solid var(--line);
      margin: 40px 0;
    }
    .post table {
      width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px;
    }
    .post th, .post td {
      text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    .post th { color: var(--muted); font-weight: 600; }
    .table-scroll { overflow-x: auto; }
    .cta-box {
      background: var(--panel); border: 1px solid var(--line);
      border-radius: 10px; padding: 24px; margin: 32px 0;
      text-align: center;
    }
    .cta-box code { font-size: 16px; color: var(--success); background: none; }
    .cta-box p { color: var(--muted); font-size: 14px; margin: 8px 0 0; }

    .post-list { padding: 48px 0 64px; }
    .post-list h1 {
      font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
      color: var(--title); margin-bottom: 8px;
    }
    .post-list .intro { color: var(--muted); font-size: 15px; margin-bottom: 40px; }
    .post-item { padding: 20px 0; border-bottom: 1px solid var(--line); }
    .post-item:last-child { border-bottom: none; }
    .post-item .date { color: var(--faint); font-size: 13px; }
    .post-item h2 { font-size: 19px; font-weight: 600; letter-spacing: -0.3px; margin: 4px 0 6px; }
    .post-item h2 a { color: var(--title); }
    .post-item h2 a:hover { color: var(--link); text-decoration: none; }
    .post-item p { color: var(--muted); font-size: 14px; }

    .related {
      margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line);
    }
    .related h2 { font-size: 15px; font-weight: 600; color: var(--muted); margin-bottom: 12px; }
    .related ul { list-style: none; padding: 0; margin: 0; }
    .related li { margin-bottom: 8px; font-size: 14px; }

    .footer {
      padding: 48px 0; border-top: 1px solid var(--line);
      text-align: center; color: var(--faint); font-size: 13px;
    }
    .footer a { color: var(--muted); }

    @media (max-width: 600px) {
      .post h1 { font-size: 26px; }
      .post { padding: 32px 0 48px; }
    }
`;

function headCommon(opts: { title: string; description: string; canonical: string; noindex?: boolean }) {
  return html`
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${opts.title}</title>
  <meta name="description" content="${opts.description}" />
  ${opts.noindex ? html`<meta name="robots" content="noindex" />` : ""}
  <meta name="theme-color" content="#1a1816" />
  <link rel="canonical" href="${opts.canonical}" />
  <link rel="alternate" type="application/rss+xml" title="ccclub blog" href="https://ccclub.dev/rss.xml" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />

  <script async src="https://www.googletagmanager.com/gtag/js?id=G-RG2RD9V66M"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-RG2RD9V66M');
  </script>
`;
}

const FOOTER = html`
    <div class="footer">
      <a href="/">← Home</a>
      &nbsp;·&nbsp;
      <a href="/blog">Blog</a>
      &nbsp;·&nbsp;
      <a href="https://github.com/mazzzystar/ccclub">GitHub</a>
      &nbsp;·&nbsp;
      <a href="https://discord.gg/6QbGWJUVHq">Discord</a>
    </div>
`;

const BRAND = html`
    <a href="/" class="brand">
      <img src="https://raw.githubusercontent.com/mazzzystar/ccclub/main/assets/icon.png" alt="ccclub" width="28" height="28" />
      <span>ccclub</span>
    </a>
`;

// ── Blog index ───────────────────────────────────────────────

function blogIndexHTML() {
  const posts = sortedPosts();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "ccclub blog",
    url: "https://ccclub.dev/blog",
    description: "Notes on coding agents, token usage, and building ccclub.",
    publisher: { "@type": "Organization", name: "ccclub", url: "https://ccclub.dev" },
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `https://ccclub.dev/blog/${p.slug}`,
      datePublished: p.datePublished,
      dateModified: postLastmod(p),
      author: { "@type": "Person", name: p.author },
    })),
  };

  return html`<!DOCTYPE html>
<html lang="en">
<head>
  ${headCommon({
    title: "Blog — ccclub",
    description: "Notes on coding agents, token usage, and building ccclub.",
    canonical: "https://ccclub.dev/blog",
  })}
  <script type="application/ld+json">${raw(JSON.stringify(jsonLd))}</script>
  <style>${raw(BLOG_CSS)}</style>
</head>
<body>
  <div class="wrap">
    ${BRAND}
    <div class="post-list">
      <h1>Blog</h1>
      <p class="intro">Notes on coding agents, token usage, and building ccclub.</p>
      ${posts.map(
        (p) => html`
      <div class="post-item">
        <div class="date">${p.displayDate}</div>
        <h2><a href="/blog/${p.slug}">${p.title}</a></h2>
        <p>${p.description}</p>
      </div>`,
      )}
    </div>
    ${FOOTER}
  </div>
</body>
</html>`;
}

// ── Blog post ────────────────────────────────────────────────

function blogPostHTML(post: BlogPost) {
  const url = `https://ccclub.dev/blog/${post.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    url,
    datePublished: post.datePublished,
    dateModified: postLastmod(post),
    author: { "@type": "Person", name: post.author, url: "https://github.com/mazzzystar" },
    publisher: { "@type": "Organization", name: "ccclub", url: "https://ccclub.dev" },
    image: "https://ccclub.dev/og.png",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };

  const others = sortedPosts().filter((p) => p.slug !== post.slug).slice(0, 4);

  return html`<!DOCTYPE html>
<html lang="en">
<head>
  ${headCommon({ title: `${post.title} — ccclub`, description: post.description, canonical: url })}

  <meta property="og:type" content="article" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="ccclub" />
  <meta property="og:title" content="${post.title}" />
  <meta property="og:description" content="${post.description}" />
  <meta property="og:image" content="https://ccclub.dev/og.png" />
  <meta property="article:author" content="${post.author}" />
  <meta property="article:published_time" content="${post.datePublished}" />
  <meta property="article:modified_time" content="${postLastmod(post)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${post.title}" />
  <meta name="twitter:description" content="${post.description}" />
  <meta name="twitter:image" content="https://ccclub.dev/og.png" />

  <script type="application/ld+json">${raw(JSON.stringify(jsonLd))}</script>
  <style>${raw(BLOG_CSS)}</style>
</head>
<body>
  <div class="wrap">
    ${BRAND}

    <article class="post">
      <div class="post-meta">${post.displayDate}</div>
      <h1>${post.title}</h1>
      ${raw(post.body)}
      ${others.length > 0
        ? html`
      <div class="related">
        <h2>More from the blog</h2>
        <ul>
          ${others.map((p) => html`<li><a href="/blog/${p.slug}">${p.title}</a></li>`)}
        </ul>
      </div>`
        : ""}
    </article>

    ${FOOTER}
  </div>
</body>
</html>`;
}

// ── 404 ──────────────────────────────────────────────────────

function blogNotFoundHTML() {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  ${headCommon({
    title: "Post not found — ccclub",
    description: "This blog post doesn't exist.",
    canonical: "https://ccclub.dev/blog",
    noindex: true,
  })}
  <style>${raw(BLOG_CSS)}</style>
</head>
<body>
  <div class="wrap">
    ${BRAND}
    <div class="post-list">
      <h1>Post not found</h1>
      <p class="intro">This post doesn't exist. See <a href="/blog">all posts</a>.</p>
    </div>
    ${FOOTER}
  </div>
</body>
</html>`;
}

export { app as blogRoute, BLOG_POSTS };
