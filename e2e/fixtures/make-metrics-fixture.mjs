// Generates a CSV of past posts WITH engagement metrics, to exercise the Performance view through the manual
// import fallback when no Meta app is configured. Usage: node e2e/fixtures/make-metrics-fixture.mjs
import { writeFileSync } from "node:fs";

const captions = [
  ["Tu bloques en maths ? Voici la méthode en 3 étapes.\nInscris-toi : lien en bio", "Reel"],
  ["5 erreurs à éviter avant le Bac 📚\nEnregistre ce post pour tes révisions", "Carrousel"],
  ["Témoignage : Yasmine a gagné 4 points en physique.", "Vidéo"],
  ["Nos horaires de la semaine.", "Post"],
  ["Comment organiser ses révisions pour les devoirs de synthèse ?\nCommente ta matière la plus difficile", "Reel"],
  ["Nouveau : cours de soutien à domicile. Réserve ta séance par message.", "Post"],
];
const header = ["Date", "Réseau", "Format", "Légende", "J'aime", "Commentaires", "Partages", "Enregistrements", "Portée"];
const rows = [];
for (let k = 0; k < 36; k++) {
  const d = new Date(Date.UTC(2024, 8, 2) + k * 9 * 86400000);
  const [caption, format] = captions[k % captions.length];
  const platform = k % 3 === 2 ? "Facebook" : "Instagram";
  // deterministic variation: reels and question hooks do better in this sample
  const base = { Reel: 140, Carrousel: 110, Vidéo: 80, Post: 30 }[format];
  const reach = 1500 + ((k * 137) % 900);
  const likes = base + ((k * 31) % 40);
  const row = [d.toISOString().slice(0, 10), platform, format, caption, likes, Math.round(likes / 9), Math.round(likes / 14), platform === "Instagram" ? Math.round(likes / 6) : "", reach];
  rows.push(row);
}
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(new URL("posts-with-metrics.csv", import.meta.url), [header, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n");
console.log(`rows: ${rows.length}`);
