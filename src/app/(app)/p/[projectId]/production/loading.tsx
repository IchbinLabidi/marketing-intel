import { getT } from "@/i18n/server";
export default async function Loading() {
  const t = await getT("production");
  return <div className="space-y-6" aria-busy="true" aria-label={t("page.loading")}><div className="h-9 w-64 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded-xl bg-muted" /><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0,1,2,3].map((i) => <div key={i} className="h-80 animate-pulse rounded-xl bg-muted" />)}</div></div>;
}
