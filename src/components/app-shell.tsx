import Link from "next/link";

/**
 * Deployment badge.
 *
 * This read "LOCAL" unconditionally, including in production — so there was no
 * way to tell from a screenshot whether you were looking at the live system or
 * somebody's laptop. It now reports the real environment, plus the deployed
 * commit, which makes "did my change actually ship?" answerable at a glance.
 *
 * `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` are injected by Vercel at build time
 * and are absent locally.
 */
function deployment() {
  const environment = process.env.VERCEL_ENV;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

  if (!environment) return { label: "LOCAL", tone: "local" as const, sha: null };

  const label = environment === "production" ? "PRODUCTION" : environment.toUpperCase();
  return { label, tone: environment === "production" ? ("production" as const) : ("preview" as const), sha: sha ?? null };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { label, tone, sha } = deployment();

  return (
    <div className="app-wrap">
      <header className="app-header">
        <Link href="/" className="brand">
          Kō<sup>sh</sup>
        </Link>
        <div className="header-rule" />
        <nav className="global-nav">
          <Link href="/cycles">Cycle Planner</Link>
          <Link href="/recipes">Recipe Database</Link>
          <Link href="/inventory">Inventory</Link>
          <Link href="/subscribers">Subscribers</Link>
          <Link href="/finance">Finance</Link>
        </nav>
        <div className="header-spacer" />
        <span className={`environment-badge env-${tone}`} title={sha ? `commit ${sha}` : "running locally"}>
          {label}
          {sha && <em className="env-sha">{sha}</em>}
        </span>
      </header>
      {children}
    </div>
  );
}
