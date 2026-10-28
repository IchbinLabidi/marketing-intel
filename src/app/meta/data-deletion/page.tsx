export const metadata = { title: "Meta data deletion" };

/** Public status page Meta links people to after a data deletion request. */
export default async function DataDeletionStatus({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code.replace(/[^a-f0-9]/gi, "").slice(0, 32) : null;
  return (
    <main className="mx-auto max-w-lg space-y-3 px-6 py-16 text-[13px]">
      <h1 className="text-lg font-semibold">Facebook / Instagram data deletion</h1>
      {code ? (
        <p>
          Request <span className="font-mono">{code}</span> is complete. The access tokens, connection settings and every post and
          metric synchronised through your Facebook account have been deleted from this service.
        </p>
      ) : (
        <p>
          To delete the data synchronised from Facebook and Instagram, remove this app in Facebook → Settings → Apps and websites, or
          use “Disconnect Meta” with “also delete synced posts” in the project’s Content history page.
        </p>
      )}
    </main>
  );
}
