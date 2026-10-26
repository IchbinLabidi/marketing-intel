// Generates realistic historical calendar files for manual and e2e testing of Historical Intelligence.
// Usage: node e2e/fixtures/make-history-fixtures.mjs   (writes into e2e/fixtures/)
import { writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const out = new URL("./", import.meta.url);
const topics = [
  ["Rentrée : 5 conseils pour bien s'organiser", "Conseils pédagogiques", "Carrousel"],
  ["Méthode de révision pour les maths", "Conseils pédagogiques", "Reel"],
  ["Témoignage d'un élève de 9e", "Témoignages", "Vidéo"],
  ["Inscriptions ouvertes : cours de soutien", "Offres & inscriptions", "Post"],
  ["Quiz physique : testez-vous", "Conseils pédagogiques", "Story"],
  ["Comment gérer le stress des examens", "Conseils pédagogiques", "Reel"],
  ["Nos profs vous présentent la plateforme", "Offres & inscriptions", "Vidéo"],
  ["Résultats de nos élèves au Bac", "Témoignages", "Carrousel"],
];
const platforms = ["Instagram", "Facebook", "TikTok", "Instagram + Facebook"];

const rows = [];
let n = 0;
for (const year of [2023, 2024]) {
  // two posts a week from mid-September to June, with a quiet December
  for (let d = new Date(Date.UTC(year, 8, 11)); d < new Date(Date.UTC(year + 1, 5, 20)); d = new Date(d.getTime() + 3.5 * 86400000)) {
    if (d.getUTCMonth() === 11 && d.getUTCDate() > 5) continue;
    const [title, pillar, format] = topics[n % topics.length];
    const bac = d.getUTCMonth() >= 3 && d.getUTCMonth() <= 4;
    rows.push([
      `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`,
      platforms[n % platforms.length],
      format,
      bac ? `Prépa Bac : ${title.toLowerCase()}` : title,
      pillar,
      bac ? "Prépa Bac" : d.getUTCMonth() === 8 ? "Rentrée scolaire" : "",
      `${title} 📚 #SOSProf`,
      "Inscris-toi sur sosprof.net",
      year === 2023 ? "Publié" : n % 5 === 0 ? "Prévu" : "Publié",
      year === 2024 && n % 3 === 0 ? String(800 + n * 13) : "",
    ]);
    n++;
  }
}
// deliberate problems the import must surface
rows.splice(5, 0, ["31/02/2024", "Instagram", "Reel", "Date impossible", "Conseils pédagogiques", "", "", "", "Prévu", ""]);
rows.splice(9, 0, [...rows[8]]); // exact duplicate
rows.splice(14, 0, ["20/10/2023", "Minitel", "Post", "Plateforme inconnue", "Humour", "", "", "", "Publié", ""]);
rows.splice(20, 0, ["25/10/2023", "Instagram", "Reel", "Portée en pourcentage", "Témoignages", "", "", "", "Publié", "12%"]);

const header = ["Date de publication", "Réseau", "Type de contenu", "Sujet", "Pilier", "Campagne", "Légende", "CTA", "Statut", "Portée"];
const ws = XLSX.utils.aoa_to_sheet([["SOS Prof — calendrier éditorial 2023-2025"], [], header, ...rows]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Calendrier");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Notes internes"], ["Ne pas importer"]]), "Notes");
writeFileSync(new URL("sosprof-calendar.xlsx", out), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
writeFileSync(new URL("header-only.csv", out), header.join(";") + "\n");
writeFileSync(new URL("empty.csv", out), "");
console.log(`rows: ${rows.length}`);
