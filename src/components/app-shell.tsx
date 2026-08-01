import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="app-wrap">
    <header className="app-header">
      <Link href="/" className="brand">Kō<sup>sh</sup></Link>
      <div className="header-rule" />
      <nav className="global-nav">
        <Link href="/cycles">Cycle Planner</Link>
        <Link href="/recipes">Recipe Database</Link>
        <Link href="/inventory">Inventory</Link>
      </nav>
      <div className="header-spacer" />
      <span className="environment-badge">LOCAL</span>
    </header>
    {children}
  </div>;
}
