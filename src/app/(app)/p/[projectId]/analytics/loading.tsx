export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading analytics">
      <div className="h-9 w-64 animate-pulse rounded bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
      <div className="grid gap-3 lg:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />)}</div>
    </div>
  );
}
