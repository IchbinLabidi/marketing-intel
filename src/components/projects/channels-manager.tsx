"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { SubmitButton, fieldError, useResultToast, useFormAction } from "@/components/app/form";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/domain/constants";
import { addChannelAction, removeChannelAction } from "@/server/actions/projects";
import type { ProjectChannel } from "@/types/domain";

export function ChannelsManager({ projectId, channels, readOnly }: { projectId: string; channels: ProjectChannel[]; readOnly: boolean }) {
  const { state, pending: saving, formProps } = useFormAction(addChannelAction.bind(null, projectId), { resetOnSuccess: true });
  const [pending, startTransition] = useTransition();
  useResultToast(state);

  return (
    <div className="space-y-4">
      {channels.length ? (
        <ul className="divide-y rounded-lg border">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
              <Badge variant="outline" className="w-24 justify-center">{PLATFORM_LABELS[c.platform]}</Badge>
              <span className="min-w-0 flex-1 truncate">
                {c.handle ? `@${c.handle.replace(/^@/, "")}` : <span className="text-muted-foreground">No handle</span>}
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="ml-2 text-muted-foreground hover:underline">
                    {c.url.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {c.target_posts_per_week != null ? `${c.target_posts_per_week}/week` : "—"}
              </span>
              {!readOnly ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove channel"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await removeChannelAction(projectId, c.id);
                      if (r.ok) toast.success(r.message);
                      else toast.error(r.error);
                    })
                  }
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">No channels yet. Add the platforms this brand publishes on.</p>
      )}
      {!readOnly ? (
        <form {...formProps} className="grid gap-2 sm:grid-cols-[140px_1fr_1fr_110px_auto] sm:items-start">
          <NativeSelect name="platform" defaultValue="instagram" aria-label="Platform">
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
          <Input name="handle" placeholder="Handle" aria-label="Handle" />
          <div>
            <Input name="url" placeholder="Profile URL (optional)" aria-label="URL" aria-invalid={Boolean(fieldError(state, "url"))} />
            {fieldError(state, "url") ? <p className="mt-1 text-xs text-destructive">{fieldError(state, "url")}</p> : null}
          </div>
          <Input name="target_posts_per_week" type="number" min={0} max={100} step="0.5" placeholder="Posts/wk" aria-label="Target posts per week" />
          <SubmitButton pending={saving} variant="outline" pendingLabel="Adding…">Add</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
