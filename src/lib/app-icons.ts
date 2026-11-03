// Official App Store listings (verified by seller name). Icons are fetched from Apple, never generated.
export const APP_ICON_SOURCES = [
  { slug: "tamara", nameAr: "تمارا", trackId: 1533512531, seller: "Tamara FZE", aliases: ["تمارا", "tamara"] },
  { slug: "tabby", nameAr: "تابي", trackId: 1528022364, seller: "Tabby FZ LLC", aliases: ["تابي", "tabby"] },
  { slug: "emkan", nameAr: "إمكان", trackId: 1508990688, seller: "EMKAN FINANCING COMPANY", aliases: ["إمكان", "امكان", "emkan"] },
  { slug: "neo", nameAr: "نيو", trackId: 1667738004, seller: "The Saudi National Bank", aliases: ["نيو", "neo", "new"] },
  { slug: "madfu", nameAr: "مدفوع", trackId: 1658723268, seller: "Madfu Limited Company", aliases: ["مدفوع", "مدفو", "madfu"] },
  { slug: "stc", nameAr: "stc", trackId: 808807355, seller: "STC", aliases: ["stc", "اس تي سي", "إس تي سي"] },
] as const;

export function matchIconSlug(company: string, aliases: string[] = []) {
  const terms = [company, ...aliases].map((t) => t.trim().toLowerCase()).filter(Boolean);
  const hit = APP_ICON_SOURCES.find((s) => s.aliases.some((a) => terms.some((t) => t === a || t.includes(a))));
  return hit?.slug ?? null;
}
