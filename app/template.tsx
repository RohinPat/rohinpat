// Re-mounts on every navigation, so each page arrives with a short fade-up
// instead of snapping in. The nav and footer live in the layout and stay put.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
