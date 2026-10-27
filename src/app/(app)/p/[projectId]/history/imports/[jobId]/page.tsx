import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ImportStatusBadge, ImportWizard } from "@/components/history/import-wizard";
import { canEdit } from "@/lib/domain/constants";
import { TARGET_FIELDS } from "@/lib/history/fields";
import { buildRows, type RawRow } from "@/lib/history/rows";
import { getImportJob, signedImportFileUrl } from "@/server/services/history";
import { getProjectContext } from "@/server/services/projects";
import { getStrategyBundle } from "@/server/services/strategy";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Review import" };

export default async function ImportJobPage({ params }: PageProps<"/p/[projectId]/history/imports/[jobId]">) {
  const { projectId, jobId } = await params;
  const { role } = await getProjectContext(projectId);
  const job = await getImportJob(projectId, jobId);
  if (!job) notFound();
  const bundle = await getStrategyBundle(projectId);
  const raw = (job.raw_rows ?? []) as RawRow[];
  const result = buildRows(raw, job.column_mapping ?? {}, {
    pillars: bundle.pillars.map((p) => ({ id: p.id, name: p.name })),
    campaigns: bundle.campaigns.map((c) => ({ id: c.id, name: c.name })),
  }, { excluded: job.excluded_rows });

  const samples = Object.fromEntries(
    job.raw_columns.map((c) => [c, raw.map((r) => r[c]).filter(Boolean).slice(0, 3).map((v) => String(v).slice(0, 40))]),
  );
  const errorRows = new Set(job.validation_errors.map((e) => e.row));
  const rawByRow = Object.fromEntries(raw.filter((r) => errorRows.has(Number(r.__row))).map((r) => [Number(r.__row), r]));
  const fileUrl = job.storage_path ? await signedImportFileUrl(job.storage_path) : null;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/p/${projectId}/history?tab=imports`}><ArrowLeft /> Historical Intelligence</Link>
      </Button>
      <PageHeader
        title={<span className="flex items-center gap-2">{job.label || job.file_name} <ImportStatusBadge status={job.status} /></span>}
        description={`${job.file_name}${job.sheet_name ? ` · sheet “${job.sheet_name}”` : ""} · uploaded ${formatDateTime(job.created_at)}`}
        actions={
          job.status === "imported" ? (
            <Button asChild size="sm" variant="outline"><Link href={`/p/${projectId}/history?tab=records&import=${job.id}`}>View {job.imported_count} records</Link></Button>
          ) : null
        }
      />
      <ImportWizard
        key={`${job.updated_at}-${JSON.stringify(job.column_mapping)}`}
        projectId={projectId}
        job={job}
        fields={TARGET_FIELDS}
        samples={samples}
        rawByRow={rawByRow}
        counts={{ total: raw.length, ready: result.rows.length, empty: result.emptyRows, excluded: result.excludedRows }}
        previewRows={result.rows.slice(0, 20).map((r) => ({
          source_row: r.source_row,
          publication_date: r.publication_date,
          platform: r.platform_raw ?? r.platform,
          title: r.title ?? r.topic ?? r.caption?.slice(0, 80) ?? null,
          format: r.format,
          content_pillar: r.content_pillar,
          pillar_linked: Boolean(r.pillar_id),
          publication_status: r.publication_status,
        }))}
        readOnly={!canEdit(role)}
        fileUrl={fileUrl}
      />
    </div>
  );
}
