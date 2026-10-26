/**
 * Lowercase, strip accents and punctuation, collapse whitespace. Arabic letters are kept; all combining marks
 * (Latin accents, Arabic hamza and harakat) are removed so "إليوس" stays one word ("اليوس") instead of being split.
 */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const STOPWORDS = new Set(
  (
    "le la les l un une des de du d et ou en au aux a pour par sur dans avec sans ce cet cette ces son sa ses leur leurs " +
    "votre vos notre nos mon ma mes ton ta tes qui que quoi dont ne pas plus est sont etre comment pourquoi quand " +
    "the a an of and or to in on at for with by from is are be how why what when your our my this that these those it its " +
    "you who whom like new get got can all just now will has have had was were one out about more here there they them their " +
    "his her she him not but yes too very than then also only some any into over send let lets see know want need make " +
    "vous nous tout tous toute toutes aussi mais comme fait faire elle ils elles leur ici voici chez sans " +
    // Arabic / Tunisian Derja function words (after normalisation)
    "على الى الا الي اللي هذا هذه هاذي هاذا كل مع عن بين باش متاع كيفاش شنوة شنوا برشا ولا وقتاش علاش اما انت انتوما احنا اليوم كنت " +
    "post publication video reel story carousel carrousel"
  ).split(" "),
);

/** Content words of a title/topic, used for similarity. */
export function contentTokens(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 5 ? t.replace(/(s|x|es)$/, "") : t)); // light plural folding (fr/en)
}

/**
 * Drops lone UTF-16 surrogates, e.g. half an emoji left by slicing a caption at a fixed length.
 * APIs that parse JSON strictly (Claude's included) reject them as invalid.
 */
export function wellFormed(text: string) {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** Removes internal item refs (H12, R3, S4) a model may have written into user-facing text. */
export function stripRefs(text: string) {
  return text
    .replace(/\s*\((?:[HRS]\d+(?:\s*[,;/]\s*|\s+(?:et|and|à|to|-)\s+)?)+\)/g, "")
    .replace(/\b[HRS]\d+\b(?:\s*[,;/]\s*[HRS]\d+\b)*/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .trim();
}

export function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
