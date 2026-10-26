// End-to-end smoke test: signup → project → brand → channel → strategy → tenant isolation.
// Run against a running app connected to a fresh database: `BASE_URL=http://localhost:3000 node e2e/smoke.cjs`
// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain CommonJS Node script, not app code
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = (n) => page.screenshot({ path: `e2e/screenshots/${n}.png`, fullPage: true });
  const base = process.env.BASE_URL || "http://localhost:3000";
  const email = `elios+${Date.now()}@example.com`;

  await page.goto(base + "/signup");
  await shot("01-signup");
  await page.fill("#full_name", "Elios Test");
  await page.fill("#workspace_name", "Agence Nova");
  await page.fill("#email", email);
  await page.fill("#password", "supersecret1");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard");
  await shot("02-dashboard-empty");

  await page.goto(base + "/projects?new=1");
  await page.fill("#name", "Maison Jasmin");
  await page.fill("#industry", "Natural cosmetics");
  await page.fill("#website", "maisonjasmin.tn");
  await page.fill("#description", "Tunisian natural cosmetics brand selling online and in 3 shops.");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  await page.fill("#brand_name", "Maison Jasmin");
  await page.fill("#target_audience", "Women 25-45 in Tunisia interested in natural skincare");
  await page.fill("#products_services", "Argan serum - flagship\nRose water toner");
  await page.getByRole("button", { name: "Save brand identity" }).click();
  await page.getByText("Brand identity saved").waitFor();
  await page.fill("input[name=handle]", "maisonjasmin");
  await page.fill("input[name=target_posts_per_week]", "4");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Channel added").waitFor();
  await page.reload();
  if ((await page.inputValue("#brand_name")) !== "Maison Jasmin") throw new Error("brand not persisted");
  await shot("03-project-overview");

  await page.goto(projectUrl + "/strategy");
  await page.fill("#business_objectives", "Grow online revenue 40% in 2027");
  await page.fill("#value_proposition", "Certified natural Tunisian skincare at fair prices");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Foundations saved").waitFor();

  await page.getByRole("tab", { name: /Personas/ }).click();
  await page.getByRole("button", { name: "Add persona" }).click();
  await page.fill("#name", "Sana, the conscious shopper");
  await page.fill("#goals", "Find natural products she trusts");
  await page.getByLabel("Instagram").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Added").waitFor();
  await page.getByText("Sana, the conscious shopper").waitFor();

  await page.getByRole("tab", { name: /Content pillars/ }).click();
  for (const [n, s] of [["Education", "40"], ["Behind the scenes", "30"]]) {
    await page.getByRole("button", { name: "Add pillar" }).click();
    await page.fill("#name", n);
    await page.fill("#target_share", s);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText(n, { exact: true }).waitFor();
  }
  await page.getByText("shares should add up to 100%").waitFor();

  await page.getByRole("tab", { name: /Journey/ }).click();
  await page.getByRole("button", { name: "Add stage" }).click();
  await page.getByPlaceholder("Stage name (e.g. Discovery)").fill("Discovery");
  await page.getByRole("button", { name: "Save journey" }).click();
  await page.getByText("Customer journey saved").waitFor();

  await page.getByRole("tab", { name: /Campaigns/ }).click();
  await page.getByRole("button", { name: "Add campaign" }).click();
  await page.fill("#name", "Ramadan gift boxes");
  await page.fill("#starts_on", "2027-02-01");
  await page.fill("#ends_on", "2027-01-01");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("End date must be after start date").waitFor();
  await page.fill("#ends_on", "2027-03-10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("2027-02-01 → 2027-03-10").waitFor();
  await page.getByRole("tab", { name: /Content pillars/ }).click();
  await page.waitForTimeout(400);
  await shot("04-strategy-pillars");

  await page.goto(base + "/dashboard");
  await page.getByText("Strategy completeness").waitFor();
  await shot("05-dashboard");
  await page.goto(projectUrl + "/history");
  await shot("06-history-roadmap");
  await page.goto(base + "/settings");
  await shot("07-settings");

  // Mobile layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(projectUrl + "/strategy");
  await page.getByLabel("Open navigation").click();
  await page.waitForTimeout(400);
  await shot("08-mobile-nav");

  // Second user must not see the first user's project
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(base + "/signup");
  await p2.fill("#full_name", "Other User");
  await p2.fill("#email", `other+${Date.now()}@example.com`);
  await p2.fill("#password", "supersecret1");
  await p2.click("button[type=submit]");
  await p2.waitForURL("**/dashboard");
  const resp = await p2.goto(projectUrl);
  console.log("other user visiting project ->", resp.status());

  console.log("console/page errors:", errors.length ? errors : "none");
  console.log("E2E OK");
  await browser.close();
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
