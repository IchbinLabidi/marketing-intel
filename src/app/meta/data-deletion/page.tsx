import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("integrations");
  return { title: t("dataDeletion.title") };
}

/** Public status page Meta links people to after a data deletion request. */
export default async function DataDeletionStatus({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = await getT("integrations");
  const code = typeof sp.code === "string" ? sp.code.replace(/[^a-f0-9]/gi, "").slice(0, 32) : null;
  return (
    <main className="mx-auto max-w-lg space-y-3 px-6 py-16 text-[13px]">
      <h1 className="text-lg font-semibold">{t("dataDeletion.heading")}</h1>
      {code ? (
        <p>
          {t.rich("dataDeletion.complete", { code: () => <span className="font-mono">{code}</span> })}
        </p>
      ) : (
        <p>
          {t("dataDeletion.howTo")}
        </p>
      )}
    </main>
  );
}
