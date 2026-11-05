import { Database, HardDrive } from "lucide-react";
import { SectionHeader } from "@/components/app/page-header";
import { Progress } from "@/components/ui/progress";
import { PLAN_LIMITS, type StorageUsage } from "@/server/services/storage-usage";
import { getFormatter, getT } from "@/i18n/server";

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** Database + uploaded files usage against the Supabase Pro plan, shown to workspace owners/admins. */
export async function StoragePanel({ usage }: { usage: StorageUsage }) {
  const [t, fmt] = await Promise.all([getT("dashboard"), getFormatter()]);
  const size = (bytes: number) => {
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < UNITS.length - 1) {
      v /= 1024;
      i++;
    }
    return `${fmt.number(v, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${t(`storage.units.${UNITS[i]}`)}`;
  };
  const share = (used: number, limit: number) => Math.min(100, (used / limit) * 100);
  const pct = (used: number, limit: number) => {
    const p = (used / limit) * 100;
    return p < 1 ? "<1" : fmt.number(p, { maximumFractionDigits: 0 });
  };
  const bucketName = (id: string) => (id === "production-media" ? t("storage.bucket.media") : id === "imports" ? t("storage.bucket.imports") : id);
  const cards = [
    { key: "database", icon: Database, title: t("storage.database"), used: usage.database_bytes, limit: PLAN_LIMITS.databaseBytes, note: t("storage.databaseNote") },
    {
      key: "files",
      icon: HardDrive,
      title: t("storage.files"),
      used: usage.files_bytes,
      limit: PLAN_LIMITS.filesBytes,
      note: t("storage.filesNote", { count: usage.files_count, workspace: size(usage.workspace_files_bytes) }),
    },
  ];

  return (
    <section className="space-y-4">
      <SectionHeader title={t("storage.title")} description={t("storage.description")} />
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <article key={c.key} className="rounded-xl border bg-card p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <c.icon className="size-4.5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold">{c.title}</h3>
                <p className="text-xs text-muted-foreground">{c.note}</p>
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight">{size(c.used)}</span>
              <span className="text-right text-xs text-muted-foreground">{t("storage.ofPlan", { limit: size(c.limit), percent: pct(c.used, c.limit) })}</span>
            </div>
            <Progress className="mt-2" value={share(c.used, c.limit)} label={c.title} />
            {c.key === "database" && usage.tables.length ? (
              <ul className="mt-4 space-y-1 text-xs">
                <li className="text-muted-foreground">{t("storage.biggestTables")}</li>
                {usage.tables.slice(0, 4).map((x) => (
                  <li key={x.name} className="flex justify-between gap-2">
                    <span className="truncate font-mono">{x.name}</span>
                    <span className="tabular-nums text-muted-foreground">{size(x.bytes)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {c.key === "files" ? (
              <ul className="mt-4 space-y-1 text-xs">
                <li className="text-muted-foreground">{t("storage.byKind")}</li>
                {usage.buckets.length ? (
                  usage.buckets.map((b) => (
                    <li key={b.id} className="flex justify-between gap-2">
                      <span className="truncate">
                        {bucketName(b.id)} · {t("storage.fileCount", { count: b.count })}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{size(b.bytes)}</span>
                    </li>
                  ))
                ) : (
                  <li>{t("storage.noFiles")}</li>
                )}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("storage.footnote")}</p>
    </section>
  );
}
