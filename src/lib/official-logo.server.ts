// Server-only: fetch a company's logo from its own official website.
// Never generates or substitutes a logo; returns null with a reason when it cannot verify one.

export type LogoResult =
  | { ok: true; dataUrl: string; mime: string; sourceUrl: string; pageUrl: string; domain: string; method: string }
  | { ok: false; reason: string; domain?: string };

const UA = "Mozilla/5.0 (compatible; iMStudioLogoBot/1.0; +https://lovable.app)";

function abs(href: string, base: string) {
  try {
    return new URL(href.replace(/&amp;/g, "&"), base).toString();
  } catch {
    return null;
  }
}

function attr(tag: string, name: string) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Same registrable site (example.com, cdn.example.com, example.com.sa). */
export function sameSite(a: string, b: string) {
  const strip = (h: string) => h.split(".").slice(-3).join(".");
  const ha = hostOf(a), hb = hostOf(b);
  if (!ha || !hb) return false;
  return ha === hb || ha.endsWith("." + hb) || hb.endsWith("." + ha) || strip(ha) === strip(hb);
}

type Candidate = { url: string; score: number; method: string };

/** Collect logo candidates from page HTML, best first. Exported for tests. */
export function logoCandidates(html: string, pageUrl: string, company: string): Candidate[] {
  const out: Candidate[] = [];
  const names = company.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = attr(tag, "src") || attr(tag, "data-src");
    if (!src || src.startsWith("data:")) continue;
    const hay = `${src} ${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""}`.toLowerCase();
    if (!/logo/.test(hay)) continue;
    const url = abs(src, pageUrl);
    if (!url) continue;
    let score = 50;
    if (/\.svg(\?|$)/i.test(url)) score += 30;
    else if (/\.png(\?|$)/i.test(url)) score += 15;
    if (names.some((n) => hay.includes(n))) score += 10;
    if (/(white|light|footer|partner|client|payment)/.test(hay)) score -= 25;
    out.push({ url, score, method: "img-logo" });
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    const url = abs(href, pageUrl);
    if (!url) continue;
    if (rel.includes("apple-touch-icon")) out.push({ url, score: 25, method: "apple-touch-icon" });
    else if (rel.includes("icon") && /\.svg(\?|$)/i.test(url)) out.push({ url, score: 22, method: "svg-icon" });
    else if (rel.includes("icon")) {
      const sizes = parseInt((attr(tag, "sizes") ?? "0").split("x")[0] || "0", 10);
      if (sizes >= 128) out.push({ url, score: 18, method: "icon" });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: (await res.text()).slice(0, 1_500_000), finalUrl: res.url || url };
}

export async function fetchOfficialLogo(company: string, domain: string, aliases: string[]): Promise<LogoResult> {
  const clean = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) return { ok: false, reason: "لم يُحدَّد موقع رسمي صالح للشركة." };
  let page: { html: string; finalUrl: string };
  try {
    page = await fetchText(`https://${clean}/`);
  } catch (e: any) {
    try {
      page = await fetchText(`https://www.${clean}/`);
    } catch {
      return { ok: false, domain: clean, reason: `تعذر فتح الموقع الرسمي ${clean} (${e?.message ?? "خطأ اتصال"}).` };
    }
  }
  // Verify the site actually belongs to the company: its name must appear in the page.
  const text = page.html.toLowerCase();
  const terms = [company, ...aliases].map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  if (!terms.some((t) => text.includes(t))) {
    return { ok: false, domain: clean, reason: `لم يُعثر على اسم «${company}» داخل ${clean}، فلم يُعتمد كموقع رسمي.` };
  }
  const cands = logoCandidates(page.html, page.finalUrl, [company, ...aliases].join(" "));
  for (const c of cands.slice(0, 6)) {
    if (!sameSite(c.url, page.finalUrl) && !/cdn|cloudfront|amazonaws|ctfassets|sanity|prismic|webflow|wp-content|imgix|storyblok|framerusercontent/i.test(c.url)) continue;
    try {
      const r = await fetch(c.url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (!r.ok) continue;
      let mime = (r.headers.get("content-type") ?? "").split(";")[0].trim();
      const buf = await r.arrayBuffer();
      if (buf.byteLength < 200 || buf.byteLength > 4_000_000) continue;
      if (/\.svg(\?|$)/i.test(c.url) && !mime.includes("svg")) mime = "image/svg+xml";
      if (!/^image\/(svg\+xml|png|webp|jpeg)$/.test(mime)) continue;
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { ok: true, dataUrl: `data:${mime};base64,${btoa(bin)}`, mime, sourceUrl: c.url, pageUrl: page.finalUrl, domain: clean, method: c.method };
    } catch {
      continue;
    }
  }
  return { ok: false, domain: clean, reason: `لم يُعثر على ملف شعار قابل للتحقق في ${clean}. ارفع الشعار الرسمي يدويًا.` };
}
