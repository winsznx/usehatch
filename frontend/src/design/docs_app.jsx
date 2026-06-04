import React from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import "./docs.css";
import { Icons } from "./icons.jsx";

/* DocsApp — Mintlify-style docs site rendered inside the Hatch frontend.
 *
 * Source markdown lives at /docs at the repo root. Vite bundles every `.md`
 * file via `import.meta.glob` at build time. The route is `/docs/:slug?` with
 * `index` as the default. Sidebar nav, sticky top bar, right-hand auto-TOC,
 * GitHub edit link. Hatch palette, no Mintlify branding.
 *
 * Lightweight by design — no MDX, no live components, no docs-as-code SDK
 * lock-in. Just markdown, syntax highlighting, and a clean reading column. */

const DOC_FILES = import.meta.glob("../../../docs/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

const DOCS = Object.fromEntries(
  Object.entries(DOC_FILES).map(([path, content]) => {
    const slug = path.split("/").pop().replace(/\.md$/, "");
    return [slug, content];
  })
);

const NAV = [
  { group: "Start here", items: [
    { slug: "index", label: "Introduction" },
    { slug: "getting-started", label: "Getting started" },
    { slug: "architecture", label: "Architecture" },
  ]},
  { group: "Reference", items: [
    { slug: "sdk-reference", label: "SDK reference" },
    { slug: "api-reference", label: "Backend API" },
    { slug: "routes", label: "Frontend routes" },
  ]},
  { group: "Operations", items: [
    { slug: "responsiveness", label: "Responsive layout" },
    { slug: "deployment", label: "Deployment" },
    { slug: "troubleshooting", label: "Troubleshooting" },
    { slug: "mainnet", label: "Mainnet readiness" },
  ]},
];

const GITHUB_REPO = "https://github.com/winsznx/usehatch";

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function useDocSlug() {
  const get = () => {
    if (typeof window === "undefined") return "index";
    const m = window.location.pathname.match(/^\/docs\/?([^/?#]*)/);
    const candidate = m && m[1] ? m[1] : "index";
    return DOCS[candidate] ? candidate : "index";
  };
  const [slug, setSlug] = React.useState(get);
  React.useEffect(() => {
    const onNav = () => setSlug(get());
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);
  return [slug, (next) => {
    window.history.pushState({}, "", `/docs/${next === "index" ? "" : next}`);
    setSlug(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }];
}

/* Auto-TOC. Scans for h2 / h3 in the markdown body and renders a right
 * column with anchor links. Active section gets a colored bar. */
function useToc(content) {
  const headings = React.useMemo(() => {
    const out = [];
    const lines = content.split("\n");
    let inCodeBlock = false;
    for (const line of lines) {
      if (line.startsWith("```")) inCodeBlock = !inCodeBlock;
      if (inCodeBlock) continue;
      const m = line.match(/^(#{2,3})\s+(.+?)\s*$/);
      if (!m) continue;
      const level = m[1].length;
      const text = m[2].replace(/[`*_]/g, "");
      out.push({ level, text, id: slugify(text) });
    }
    return out;
  }, [content]);
  const [activeId, setActiveId] = React.useState(null);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      const offsets = headings.map((h) => {
        const el = document.getElementById(h.id);
        if (!el) return { id: h.id, top: Infinity };
        return { id: h.id, top: el.getBoundingClientRect().top };
      });
      const passed = offsets.filter((o) => o.top < 120);
      const current = passed.length ? passed[passed.length - 1].id : (offsets[0] && offsets[0].id);
      setActiveId(current ?? null);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [headings]);
  return { headings, activeId };
}

function Sidebar({ slug, onNavigate }) {
  const navigate = useNavigate();
  return (
    <aside className="docs-sidebar">
      <div className="docs-side-head">
        <button className="docs-brand" onClick={() => navigate("/")}>
          <img src="/hatch-logo.jpg" alt="" />
          <span>Hatch</span>
        </button>
        <div className="docs-side-version">SDK 0.2.0</div>
      </div>
      <nav className="docs-nav">
        {NAV.map((group) => (
          <div className="docs-nav-group" key={group.group}>
            <div className="docs-nav-group-h">{group.group}</div>
            {group.items.map((item) => (
              <button
                key={item.slug}
                className={"docs-nav-item " + (slug === item.slug ? "active" : "")}
                onClick={() => onNavigate(item.slug)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="docs-side-foot">
        <a href={GITHUB_REPO} target="_blank" rel="noreferrer" className="docs-side-link">
          <Icons.ExternalLink size={12} /> GitHub
        </a>
        <a href="https://www.npmjs.com/package/@usehatch/sdk" target="_blank" rel="noreferrer" className="docs-side-link">
          <Icons.ExternalLink size={12} /> npm
        </a>
        <button className="docs-side-link" onClick={() => navigate("/console")}>
          <Icons.ArrowRight size={12} /> Open Hatch
        </button>
      </div>
    </aside>
  );
}

function TocPanel({ slug, headings, activeId }) {
  if (!headings.length) return null;
  return (
    <aside className="docs-toc">
      <div className="docs-toc-h">On this page</div>
      <ul>
        {headings.map((h) => (
          <li key={h.id} className={"lvl-" + h.level + (activeId === h.id ? " active" : "")}>
            <a href={`#${h.id}`}>{h.text}</a>
          </li>
        ))}
      </ul>
      <div className="docs-toc-foot">
        <a href={`${GITHUB_REPO}/blob/main/docs/${slug}.md`} target="_blank" rel="noreferrer">
          <Icons.ExternalLink size={11} /> Edit on GitHub
        </a>
      </div>
    </aside>
  );
}

function MobileTopBar({ onOpenSidebar, slug }) {
  const navigate = useNavigate();
  const currentLabel = NAV.flatMap((g) => g.items).find((i) => i.slug === slug)?.label ?? "Docs";
  return (
    <div className="docs-mobile-top">
      <button className="docs-mobile-burger" onClick={onOpenSidebar} aria-label="Open navigation">
        <Icons.Menu size={18} />
      </button>
      <button className="docs-brand small" onClick={() => navigate("/")}>
        <img src="/hatch-logo.jpg" alt="" />
        <span>Hatch · {currentLabel}</span>
      </button>
    </div>
  );
}

function DocsApp() {
  const [slug, setSlug] = useDocSlug();
  const content = DOCS[slug] ?? DOCS["index"];
  const { headings, activeId } = useToc(content);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const onNav = (next) => { setSlug(next); setMobileOpen(false); };

  // Hash anchor scroll on initial load
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, [slug]);

  return (
    <div className="docs-root">
      <MobileTopBar onOpenSidebar={() => setMobileOpen(true)} slug={slug} />
      {mobileOpen && (
        <div className="docs-sidebar-backdrop" onClick={() => setMobileOpen(false)}>
          <div className="docs-sidebar-mobile" onClick={(e) => e.stopPropagation()}>
            <Sidebar slug={slug} onNavigate={onNav} />
          </div>
        </div>
      )}
      <Sidebar slug={slug} onNavigate={onNav} />
      <main className="docs-main">
        <article className="docs-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug, rehypeHighlight]}
            components={{
              a({ href, children, ...props }) {
                // Rewrite internal doc links so they navigate via the router.
                if (typeof href === "string" && href.endsWith(".md") && !href.startsWith("http")) {
                  const target = href.replace(/^\.\//, "").replace(/\.md$/, "");
                  return (
                    <a href={`/docs/${target === "index" ? "" : target}`}
                       onClick={(e) => { e.preventDefault(); onNav(target); }}>
                      {children}
                    </a>
                  );
                }
                // Rewrite source-tree links (../file) to GitHub.
                if (typeof href === "string" && href.startsWith("../")) {
                  const rel = href.replace(/^\.\.\//, "");
                  return <a href={`${GITHUB_REPO}/blob/main/${rel}`} target="_blank" rel="noreferrer">{children}</a>;
                }
                const external = href && /^https?:/.test(href);
                return <a href={href} {...props} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{children}</a>;
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </main>
      <TocPanel slug={slug} headings={headings} activeId={activeId} />
    </div>
  );
}

export { DocsApp };
