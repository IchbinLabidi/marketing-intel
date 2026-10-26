import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { autoMapColumns } from "@/lib/history/fields";
import { normalizeFormat, parseCount, parseDate, parsePlatforms, statusGroup } from "@/lib/history/parse";
import { buildRows, coveredPeriod, matchRef, type RawRow } from "@/lib/history/rows";
import { findRepetitions } from "@/lib/history/similarity";
import { computeHistoricalStats, type AnalysisItem } from "@/lib/history/analysis";
import { comparePeriods, itemsInPeriod, parsePeriod } from "@/lib/history/compare";
import { schoolYearOf, seasonWindows } from "@/lib/history/seasons";
import { stripRefs, wellFormed } from "@/lib/history/text";
import { extractCsv, extractSpreadsheet, fileKind, matrixToRows } from "@/server/imports/extract";
import { calendarDraftSchema, pdfExtractionSchema, recommendationsSchema, statsDigest } from "@/server/ai/history";

const refs = {
  pillars: [{ id: "p-edu", name: "Conseils pédagogiques" }, { id: "p-proof", name: "Témoignages" }],
  campaigns: [{ id: "c-bac", name: "Prépa Bac" }],
};

describe("parsing", () => {
  it("reads the date formats found in real calendars", () => {
    expect(parseDate("2024-09-15")).toBe("2024-09-15");
    expect(parseDate("15/09/2024")).toBe("2024-09-15");
    expect(parseDate("5-9-24")).toBe("2024-09-05");
    expect(parseDate("09/25/2024")).toBe("2024-09-25"); // only possible as US order
    expect(parseDate("lundi 16 septembre 2024")).toBe("2024-09-16");
    expect(parseDate("Sept. 3, 2024")).toBe("2024-09-03");
    expect(parseDate("45550")).toBe("2024-09-15"); // Excel serial
    expect(parseDate("31/02/2024")).toBeNull();
    expect(parseDate("next week")).toBeNull();
  });
  it("recognises platforms and keeps multi-platform cells", () => {
    expect(parsePlatforms("Insta")).toEqual(["instagram"]);
    expect(parsePlatforms("Instagram + Facebook")).toEqual(["instagram", "facebook"]);
    expect(parsePlatforms("TikTok")).toEqual(["tiktok"]);
    expect(parsePlatforms("Pigeon voyageur")).toEqual([]);
  });
  it("parses counts and refuses percentages", () => {
    expect(parseCount("1 234").value).toBe(1234);
    expect(parseCount("1,2k").value).toBe(1200);
    expect(parseCount("3.4K").value).toBe(3400);
    expect(parseCount("1.234").value).toBe(1234);
    expect(parseCount("12%").error).toMatch(/percentage/);
    expect(parseCount("-").value).toBeNull();
  });
  it("groups formats and statuses without inventing publication", () => {
    expect(normalizeFormat("Reel")).toBe("Short video");
    expect(normalizeFormat("Carrousel")).toBe("Carousel");
    expect(normalizeFormat("Post")).toBe("Image post");
    expect(normalizeFormat("Post texte")).toBe("Image post"); // first matching rule wins; text-only needs "texte"/"thread"
    expect(normalizeFormat("Thread")).toBe("Text post");
    expect(statusGroup("Publié")).toBe("published");
    expect(statusGroup("Prévu")).toBe("planned");
    expect(statusGroup("À publier")).toBe("planned");
    expect(statusGroup("Non publié")).toBe("cancelled");
    expect(statusGroup("")).toBe("unknown");
  });
});

describe("column mapping", () => {
  it("maps French, English and Arabic headers, each column once", () => {
    const m = autoMapColumns(["Date de publication", "Réseau", "Type de contenu", "Sujet", "Pilier", "Campagne", "Légende", "Statut", "Portée", "Leads", "Remarques"]);
    expect(m).toMatchObject({
      publication_date: "Date de publication", platform: "Réseau", format: "Type de contenu", topic: "Sujet", content_pillar: "Pilier",
      campaign: "Campagne", caption: "Légende", publication_status: "Statut", reach: "Portée", leads: "Leads", description: "Remarques",
    });
    expect(autoMapColumns(["التاريخ", "المنصة"])).toMatchObject({ publication_date: "التاريخ", platform: "المنصة" });
    const values = Object.values(autoMapColumns(["Date", "Date"]));
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("row validation", () => {
  const mapping = { publication_date: "Date", platform: "Réseau", title: "Titre", content_pillar: "Pilier", campaign: "Campagne", reach: "Portée", publication_status: "Statut" };
  const row = (n: number, v: Record<string, string>): RawRow => ({ __row: String(n), Date: "", Réseau: "", Titre: "", Pilier: "", Campagne: "", Portée: "", Statut: "", ...v });

  it("normalises rows, links strategy records and never discards silently", () => {
    const raw = [
      row(2, { Date: "02/09/2024", Réseau: "Insta", Titre: "5 astuces pour la rentrée", Pilier: "conseils pédagogiques", Campagne: "Prépa Bac", Portée: "1 200", Statut: "Publié" }),
      row(3, { Date: "31/02/2024", Titre: "Date impossible" }),
      row(4, {}),
      row(5, { Date: "03/09/2024", Réseau: "Minitel", Titre: "Plateforme inconnue", Pilier: "Humour" }),
      row(6, { Date: "02/09/2024", Réseau: "Instagram", Titre: "5 astuces pour la rentrée" }),
      row(7, { Date: "04/09/2024", Réseau: "Facebook" }),
      row(8, { Date: "05/09/2024", Titre: "Exclu", Portée: "12%" }),
    ];
    const r = buildRows(raw, mapping, refs, { excluded: [8] });
    expect(r.emptyRows).toBe(1);
    expect(r.excludedRows).toBe(1);
    expect(r.errors.map((e) => e.row).sort()).toEqual([3, 7]);
    expect(r.rows.map((x) => x.source_row)).toEqual([2, 5, 6]);
    const first = r.rows[0];
    expect(first).toMatchObject({ publication_date: "2024-09-02", platform: "instagram", pillar_id: "p-edu", campaign_id: "c-bac", reach: 1200, publication_status: "Publié" });
    const unknown = r.rows[1];
    expect(unknown.platform).toBe("other");
    expect(unknown.pillar_id).toBeNull();
    expect(unknown.content_pillar).toBe("Humour");
    expect(r.warnings.some((w) => w.row === 6 && /duplicate of row 2/.test(w.message))).toBe(true);
    expect(r.warnings.some((w) => w.row === 5 && w.field === "platform")).toBe(true);
    expect(coveredPeriod(r.rows)).toEqual({ start: "2024-09-02", end: "2024-09-03" });
  });
  it("does not guess between ambiguous strategy matches", () => {
    expect(matchRef("Conseils", [{ id: "a", name: "Conseils parents" }, { id: "b", name: "Conseils élèves" }])).toBeNull();
    expect(matchRef("Témoignages", refs.pillars)).toBe("p-proof");
  });
});

describe("file extraction", () => {
  it("detects the header row under a title row in Excel files", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Calendrier éditorial 2024"], [], ["Date", "Plateforme", "Titre"], ["2024-09-02", "Instagram", "Rentrée"], ["2024-09-05", "TikTok", "Quiz maths"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Septembre");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Vide");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const out = extractSpreadsheet(buffer);
    expect(out.sheets).toEqual(["Septembre"]);
    expect(out.headers).toEqual(["Date", "Plateforme", "Titre"]);
    expect(out.rows[0]).toMatchObject({ __row: "4", Date: "2024-09-02", Titre: "Rentrée" });
  });
  it("reads legacy .xls workbooks", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Date", "Titre"], ["2023-10-01", "Ancien format"]]), "S1");
    const out = extractSpreadsheet(XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer);
    expect(out.rows[0].Titre).toBe("Ancien format");
  });
  it("reads semicolon CSV exported by Excel in Windows-1252", () => {
    const text = "Date;Réseau;Titre\n02/09/2024;Facebook;Révisions\n";
    const latin1 = Buffer.from([...text].map((c) => c.charCodeAt(0)));
    const out = extractCsv(latin1);
    expect(out.headers).toEqual(["Date", "Réseau", "Titre"]);
    expect(out.rows[0].Titre).toBe("Révisions");
  });
  it("names blank and duplicate headers and rejects unsupported files", () => {
    expect(matrixToRows([["Date", "", "Date"], ["1", "2", "3"]]).headers).toEqual(["Date", "Column 2", "Date (2)"]);
    expect(fileKind("cal.xls")?.kind).toBe("xlsx");
    expect(fileKind("cal.docx")).toBeNull();
    // Text is opened as a one-cell sheet (this is how HTML ".xls" exports load); it yields no data rows,
    // which the import reports as "no data rows" instead of importing anything.
    expect(extractSpreadsheet(Buffer.from("not a workbook at all")).rows).toEqual([]);
  });
});

const item = (id: string, d: string | null, extra: Partial<AnalysisItem> = {}): AnalysisItem => ({
  id, import_job_id: "j1", publication_date: d, actual_publication_date: null, platform: "instagram", title: null, topic: null, caption: null,
  format: "Reel", content_pillar: null, pillar_id: null, campaign: null, campaign_id: null, publication_status: null, ...extra,
});

describe("analysis", () => {
  it("tells repeated angles apart from recurring educational themes", () => {
    const clusters = findRepetitions([
      { id: "a", text: "Méthode révision examen mathématiques", date: "2024-03-01", format: "Carousel", platform: "instagram" },
      { id: "b", text: "Méthode révision examen mathématiques", date: "2024-03-10", format: "Carousel", platform: "instagram" },
      { id: "c", text: "Préparer le bac philosophie conseils", date: "2023-05-01", format: "Video", platform: "youtube" },
      { id: "d", text: "Préparer le bac philosophie conseils pratiques", date: "2024-05-03", format: "Carousel", platform: "instagram" },
      { id: "e", text: "Concours de dessin", date: "2024-01-01", format: "Image post", platform: "facebook" },
    ]);
    expect(clusters.find((c) => c.ids.includes("a"))?.kind).toBe("near_duplicate");
    expect(clusters.find((c) => c.ids.includes("c"))?.kind).toBe("recurring_theme");
    expect(clusters.some((c) => c.ids.includes("e"))).toBe(false);
  });

  it("computes distribution, pillar balance, gaps and seasonality from real dates only", () => {
    const items: AnalysisItem[] = [
      ...Array.from({ length: 12 }, (_, k) => item(`s${k}`, `2024-09-${String(2 + k).padStart(2, "0")}`, { pillar_id: "p-edu", publication_status: "Publié", campaign: "Rentrée" })),
      item("o1", "2024-10-20", { pillar_id: "p-edu", format: "Carrousel" }),
      item("n1", "2024-11-25", { pillar_id: "p-edu", publication_status: "Prévu" }),
      item("x", null, { content_pillar: "Humour", platform: null }),
    ];
    const s = computeHistoricalStats(items, {
      pillars: [{ id: "p-edu", name: "Conseils", target_share: 50 }, { id: "p-proof", name: "Témoignages", target_share: 50 }],
      campaigns: [],
      channels: [{ platform: "instagram", is_active: true, target_posts_per_week: 3 }, { platform: "tiktok", is_active: true, target_posts_per_week: 2 }],
      ramadanRelevant: false,
    });
    expect(s.totals).toMatchObject({ items: 15, dated: 14, start: "2024-09-02", end: "2024-11-25" });
    expect(s.totals.status).toMatchObject({ published: 12, planned: 1, unknown: 2 });
    expect(s.byMonth.map((m) => m.count)).toEqual([12, 1, 1]);
    expect(s.pillarBalance.find((p) => p.id === "p-proof")?.status).toBe("missing");
    expect(s.pillarBalance.find((p) => p.id === "p-edu")?.status).toBe("over");
    expect(s.unlinkedPillarText).toBe(1);
    expect(s.formatGaps.find((g) => g.platform === "tiktok")?.missing).toContain("Short video");
    expect(s.frequency.silentGaps.map((g) => [g.from, g.days])).toEqual([["2024-09-13", 37], ["2024-10-20", 36]]);
    // Neither window is fully inside the imported dates (2 Sept → 25 Nov), so neither is measured.
    expect(s.seasons.find((x) => x.key === "back_to_school")?.pattern).toBe("not_covered");
    expect(s.seasons.find((x) => x.key === "term1_exams")?.pattern).toBe("not_covered");
    expect(s.seasons.some((x) => x.key === "ramadan")).toBe(false);
    expect(s.metrics.coverage).toEqual([]);
    expect(statsDigest(s, () => undefined)).toContain("NONE. You must not say any content performed well or badly");
  });

  it("measures a season only inside fully covered windows and detects peaks", () => {
    // one post a week all school year, plus a burst during Bac preparation
    const weekly = Array.from({ length: 52 }, (_, k) => item(`w${k}`, new Date(Date.UTC(2024, 7, 25) + k * 7 * 86400000).toISOString().slice(0, 10)));
    const burst = Array.from({ length: 10 }, (_, k) => item(`b${k}`, `2025-04-${String(k + 5).padStart(2, "0")}`, { campaign: "Prépa Bac" }));
    const s = computeHistoricalStats([...weekly, ...burst], { pillars: [], campaigns: [], channels: [], ramadanRelevant: true });
    const bac = s.seasons.find((x) => x.key === "bac_preparation")!;
    expect(bac.pattern).toBe("peak");
    expect(bac.years[0]).toMatchObject({ schoolYear: "2024-2025", campaigns: ["Prépa Bac"] });
    expect(s.seasons.find((x) => x.key === "ramadan")?.years.length).toBe(1);
  });

  it("only reports metric averages when enough values exist", () => {
    const items = Array.from({ length: 8 }, (_, k) => item(`m${k}`, `2024-01-${String(k + 1).padStart(2, "0")}`, { format: k < 4 ? "Reel" : "Carrousel", reach: 100 * (k + 1) }));
    const s = computeHistoricalStats(items, { pillars: [], campaigns: [], channels: [], ramadanRelevant: false });
    expect(s.metrics.coverage).toEqual([{ metric: "reach", values: 8 }]);
    expect(s.metrics.byFormat[0].rows.map((r) => r.format)).toEqual(["Carousel", "Short video"]);
  });

  it("compares two school years", () => {
    const items = [item("a1", "2023-10-01", { campaign: "Rentrée" }), item("a2", "2024-02-01"), item("b1", "2024-10-01", { campaign: "Rentrée", format: "Carousel" }), item("b2", "2024-11-01", { campaign: "Bac blanc" }), item("b3", "2025-03-01")];
    const a = itemsInPeriod(items, parsePeriod("school_year:2023-2024")!);
    const b = itemsInPeriod(items, parsePeriod("school_year:2024-2025")!);
    const c = comparePeriods(a, b, () => undefined);
    expect(c.volume).toMatchObject({ a: 2, b: 3, delta: 1, deltaPct: 50 });
    expect(c.campaigns).toEqual({ onlyA: [], onlyB: ["Bac blanc"], both: ["Rentrée"] });
    expect(parsePeriod("school_year:bad")).toBeNull();
  });

  it("builds school-year and Ramadan windows", () => {
    expect(schoolYearOf("2024-09-01")).toBe("2024-2025");
    expect(schoolYearOf("2025-06-15")).toBe("2024-2025");
    const w = seasonWindows("2024-09-01", "2025-08-31");
    expect(w.find((x) => x.key === "bac_preparation")).toMatchObject({ start: "2025-04-01", end: "2025-05-31" });
    expect(w.find((x) => x.key === "ramadan")).toMatchObject({ start: "2025-03-01" });
  });
});

describe("AI text hygiene", () => {
  it("never sends half an emoji to the API", () => {
    const caption = "Bac 2024 👋 bonne chance";
    const cut = caption.slice(0, caption.indexOf("👋") + 1); // slicing splits the emoji's surrogate pair
    expect(() => JSON.parse(JSON.stringify(wellFormed(cut)))).not.toThrow();
    expect(wellFormed(cut)).toBe("Bac 2024 ");
    expect(wellFormed(caption)).toBe(caption); // complete emoji are kept
    expect(wellFormed("نشاركوكم ❤️ Tunis")).toBe("نشاركوكم ❤️ Tunis");
  });

  it("removes internal item refs from user-facing text", () => {
    expect(stripRefs("Ce carrousel revient chaque mois (H60, H68, H132) et en juin (H76 et H148).")).toBe("Ce carrousel revient chaque mois et en juin.");
    expect(stripRefs("Voir H12, H13 pour le détail")).toBe("Voir pour le détail");
    expect(stripRefs("Prépa Bac 2025 en H2")).toBe("Prépa Bac 2025 en"); // only H/R + digits tokens
    expect(stripRefs("Ligne 1\n\nLigne 2")).toBe("Ligne 1\n\nLigne 2");
  });
});

describe("AI output schemas", () => {
  it("convert to structured-output JSON schemas", () => {
    for (const schema of [pdfExtractionSchema, recommendationsSchema, calendarDraftSchema]) {
      expect(betaZodOutputFormat(schema).type).toBe("json_schema");
    }
  });
});
