import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, allowedTaskTransitions, canGrant, legacyPermissions, type Permission } from "@/lib/permissions";

const sql = readFileSync(join(__dirname, "../supabase/migrations/0013_team_collaboration.sql"), "utf8");
const arrayAfter = (marker: string) => {
  const start = sql.indexOf(marker);
  const body = sql.slice(sql.indexOf("array[", start) + 6, sql.indexOf("]", sql.indexOf("array[", start)));
  return [...body.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
};
const role = (key: string) => {
  const line = sql.split("\n").findIndex((l) => l.includes(`(ws, '${key}',`));
  const chunk = sql.split("\n").slice(line, line + 6).join("\n");
  const arr = chunk.slice(chunk.indexOf("array[") + 6, chunk.indexOf("]", chunk.indexOf("array[")));
  return new Set([...arr.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]));
};
const set = (...p: Permission[]) => new Set<string>(p);

describe("permission catalogue", () => {
  it("matches the database catalogue exactly", () => {
    expect(arrayAfter("function team_all_permissions()").sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("keeps the previous editor and viewer access identical to the database", () => {
    expect(arrayAfter("when 'editor' then array[").sort()).toEqual(legacyPermissions("editor").sort());
    expect(arrayAfter("else array[").sort()).toEqual(legacyPermissions("viewer").sort());
  });

  it("gives previous editors no team management and no final approval", () => {
    const editor = legacyPermissions("editor");
    expect(editor).not.toContain("team.manage");
    expect(editor).not.toContain("roles.manage");
    expect(editor).not.toContain("content.approve");
    expect(legacyPermissions("admin")).toEqual(ALL_PERMISSIONS);
  });
});

describe("system roles follow least privilege", () => {
  it("designer and video editor only read the strategy; everything else comes from assignments", () => {
    expect([...role("designer")]).toEqual(["strategy.view"]);
    expect([...role("video_editor")]).toEqual(["strategy.view"]);
  });
  it("content creators cannot see all content, assign, or approve", () => {
    const r = role("content_creator");
    for (const p of ["content.view_all", "content.assign", "content.approve", "content.review", "team.manage"]) expect(r.has(p)).toBe(false);
  });
  it("marketing managers assign, review and approve, but cannot manage the team or approve their own work", () => {
    const r = role("marketing_manager");
    for (const p of ["content.assign", "content.review", "content.approve", "content.view_all"]) expect(r.has(p)).toBe(true);
    for (const p of ["team.manage", "roles.manage", "settings.manage", "content.approve_own"]) expect(r.has(p)).toBe(false);
  });
  it("SEO specialists get SEO research but not the rest of the intelligence modules", () => {
    const r = role("seo_specialist");
    expect(r.has("seo.edit")).toBe(true);
    expect(r.has("intelligence.view")).toBe(false);
  });
});

describe("escalation rules", () => {
  it("cannot grant permissions you do not hold", () => {
    const manager = set("team.manage", "content.assign");
    expect(canGrant(manager, ["content.assign"])).toBe(true);
    expect(canGrant(manager, ["content.assign", "roles.manage"])).toBe(false);
  });
});

describe("task workflow transitions", () => {
  const creator = set("strategy.view");
  const manager = set("content.assign", "content.review", "content.approve");

  it("lets the task owner start and submit their work, but not approve it", () => {
    expect(allowedTaskTransitions({ status: "assigned", task_type: "copywriting", mine: true }, creator)).toEqual(["backlog", "in_progress", "in_review"]);
    expect(allowedTaskTransitions({ status: "in_review", task_type: "copywriting", mine: true }, creator)).not.toContain("approved");
  });

  it("lets a manager approve or request changes on work in review", () => {
    const next = allowedTaskTransitions({ status: "in_review", task_type: "design", mine: false }, manager);
    expect(next).toContain("approved");
    expect(next).toContain("changes_requested");
  });

  it("does not let a reviewer approve their own task without approve_own", () => {
    expect(allowedTaskTransitions({ status: "in_review", task_type: "copywriting", mine: true }, manager)).not.toContain("approved");
    expect(allowedTaskTransitions({ status: "in_review", task_type: "copywriting", mine: true }, new Set([...manager, "content.approve_own"]))).toContain("approved");
  });

  it("closes the task for its owner once approved", () => {
    expect(allowedTaskTransitions({ status: "approved", task_type: "design", mine: true }, creator)).toEqual(["completed"]);
    expect(allowedTaskTransitions({ status: "completed", task_type: "design", mine: true }, creator)).toEqual([]);
  });

  it("gives someone else's task no transitions to a non-manager", () => {
    expect(allowedTaskTransitions({ status: "in_progress", task_type: "design", mine: false }, creator)).toEqual([]);
  });
});
