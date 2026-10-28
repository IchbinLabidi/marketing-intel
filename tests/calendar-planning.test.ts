import { describe, expect, it } from "vitest";
import { contentType, deadlineConflicts, isOverdue, participants, type Person } from "@/components/calendar/planning";
import { shiftView, viewRange } from "@/lib/calendar/time";
import type { Task } from "@/server/services/team";
import type { ContentItem } from "@/types/domain";

const item = (over: Partial<ContentItem>): ContentItem => ({ id: "c1", status: "in_production", title: "T", format: null, platform: "instagram", ...over }) as ContentItem;
const task = (over: Partial<Task>): Task => ({ id: "t", project_id: "p", content_item_id: "c1", user_id: "u2", task_type: "design", status: "assigned", priority: "medium", due_date: null, note: "", created_by: null, created_at: "", updated_at: "", ...over });

describe("calendar planning", () => {
  it("flags only open work whose internal deadline has passed", () => {
    expect(isOverdue(item({ due_date: "2026-10-01" }), "2026-10-02")).toBe(true);
    expect(isOverdue(item({ due_date: "2026-10-02" }), "2026-10-02")).toBe(false);
    expect(isOverdue(item({ due_date: "2026-10-01", status: "approved" }), "2026-10-02")).toBe(false);
    expect(isOverdue(item({ due_date: null }), "2026-10-02")).toBe(false);
  });

  it("maps free-text formats to short content types", () => {
    expect(contentType("Instagram Reel")).toBe("Reel");
    expect(contentType("Story sequence")).toBe("Story");
    expect(contentType("Facebook video")).toBe("Video");
    expect(contentType(null)).toBe("Post");
  });

  it("lists the lead first, then collaborators, without duplicates", () => {
    const people = new Map<string, Person>([["u1", { user_id: "u1", name: "Ana", roleName: null, canEdit: true }], ["u2", { user_id: "u2", name: "Bo", roleName: null, canEdit: true }]]);
    const ps = participants(item({ assignee_id: "u1" }), [task({ user_id: "u2" }), task({ id: "t2", user_id: "u1", task_type: "copywriting" })], people);
    expect(ps.map((p) => p.name)).toEqual(["Ana", "Bo"]);
  });

  it("reports a workload conflict when one person has several open deadlines on a day", () => {
    const c = deadlineConflicts(
      [item({ id: "a", assignee_id: "u1", due_date: "2026-11-05" }), item({ id: "b", assignee_id: "u1", due_date: "2026-11-05" }), item({ id: "c", assignee_id: "u2", due_date: "2026-11-05" })],
      [task({ content_item_id: "c", user_id: "u2", due_date: "2026-11-06", status: "completed" })],
    );
    expect(c.get("2026-11-05")).toEqual([{ userId: "u1", count: 2 }]);
    expect(c.has("2026-11-06")).toBe(false);
  });
});

describe("list and timeline ranges", () => {
  it("cover the calendar month and step by month", () => {
    expect(viewRange("list", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(viewRange("timeline", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(shiftView("timeline", "2026-01-31", 1).slice(0, 7)).toBe("2026-02");
  });
});
