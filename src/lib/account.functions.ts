import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { APP_ICON_SOURCES } from "./app-icons";

async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || data !== true) throw new Error("هذه العملية للمدير فقط.");
}

// ---------- Profile ----------
export const getMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase;
    const [profile, roles, projects, jobs, usage] = await Promise.all([
      s.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      s.from("user_roles").select("role").eq("user_id", context.userId),
      s.from("projects").select("id,name,kind,status,updated_at").eq("user_id", context.userId).order("updated_at", { ascending: false }).limit(50),
      s.from("generation_jobs").select("id,kind,status,error,created_at").eq("user_id", context.userId).order("created_at", { ascending: false }).limit(30),
      s.from("usage_events").select("service,units,unit,created_at").eq("user_id", context.userId).order("created_at", { ascending: false }).limit(200),
    ]);
    if (profile.error) throw new Error("تعذر تحميل الملف الشخصي.");
    const designs = (usage.data ?? []).filter((u) => u.service === "image").length;
    return {
      profile: profile.data,
      roles: (roles.data ?? []).map((r) => r.role),
      projects: projects.data ?? [],
      jobs: jobs.data ?? [],
      designs,
      totalOps: (usage.data ?? []).length,
    };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ confirm: z.literal("حذف") }))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: files } = await supabaseAdmin.storage.from("studio").list(uid, { limit: 1000 });
    // Remove nested files too (projects are stored as <uid>/<project>/...)
    const paths: string[] = [];
    for (const f of files ?? []) {
      if (f.id) paths.push(`${uid}/${f.name}`);
      else {
        const { data: inner } = await supabaseAdmin.storage.from("studio").list(`${uid}/${f.name}`, { limit: 1000 });
        for (const g of inner ?? []) paths.push(`${uid}/${f.name}/${g.name}`);
      }
    }
    if (paths.length) await supabaseAdmin.storage.from("studio").remove(paths);
    for (const t of ["usage_events", "generation_jobs", "assets", "projects", "chat_messages", "support_tickets"] as const) {
      const { error } = await supabaseAdmin.from(t).delete().eq("user_id", uid);
      if (error) throw new Error("تعذر حذف بعض البيانات، لم يُحذف الحساب.");
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) throw new Error("تعذر حذف الحساب.");
    return { ok: true };
  });

// ---------- Support ----------
export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ subject: z.string().trim().min(3).max(150), body: z.string().trim().min(10).max(4000) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("support_tickets").insert({ user_id: context.userId, subject: data.subject, body: data.body });
    if (error) throw new Error("تعذر إرسال الطلب.");
    return { ok: true };
  });

// ---------- Admin ----------
export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: authUsers, error }, profiles, roles, projects, usage] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }).then((r) => ({ data: r.data?.users ?? [], error: r.error })),
      supabaseAdmin.from("profiles").select("*"),
      supabaseAdmin.from("user_roles").select("user_id,role"),
      supabaseAdmin.from("projects").select("user_id"),
      supabaseAdmin.from("usage_events").select("user_id"),
    ]);
    if (error) throw new Error("تعذر تحميل المستخدمين.");
    const count = (rows: { user_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.user_id === id).length;
    return authUsers.map((u) => {
      const p = (profiles.data ?? []).find((x) => x.id === u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        confirmed: !!u.email_confirmed_at,
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at ?? null,
        name: p?.display_name ?? "",
        plan: p?.plan ?? "free",
        credits: Number(p?.credits ?? 0),
        suspended: !!p?.suspended,
        roles: (roles.data ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
        projects: count(projects.data, u.id),
        ops: count(usage.data, u.id),
      };
    });
  });

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      userId: z.string().uuid(),
      plan: z.string().trim().min(1).max(40).optional(),
      credits: z.number().min(0).max(1_000_000).optional(),
      suspended: z.boolean().optional(),
      admin: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.plan !== undefined) patch.plan = data.plan;
    if (data.credits !== undefined) patch.credits = data.credits;
    if (data.suspended !== undefined) patch.suspended = data.suspended;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.userId);
      if (error) throw new Error("تعذر تحديث المستخدم.");
    }
    if (data.suspended !== undefined) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: data.suspended ? "876000h" : "none" });
      if (error) throw new Error("تعذر تغيير حالة الحساب.");
    }
    if (data.admin !== undefined) {
      if (data.userId === context.userId && !data.admin) throw new Error("لا يمكنك إزالة صلاحيتك بنفسك.");
      const r = data.admin
        ? await supabaseAdmin.from("user_roles").upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" })
        : await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", "admin");
      if (r.error) throw new Error("تعذر تحديث الصلاحيات.");
    }
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    if (data.userId === context.userId) throw new Error("لا يمكنك حذف حسابك من هنا.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const t of ["usage_events", "generation_jobs", "assets", "projects", "chat_messages", "support_tickets"] as const) {
      await supabaseAdmin.from(t).delete().eq("user_id", data.userId);
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error("تعذر حذف المستخدم.");
    return { ok: true };
  });

export const adminTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("تعذر تحميل طلبات الدعم.");
    return data ?? [];
  });

export const adminReplyTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), reply: z.string().trim().max(4000), status: z.enum(["open", "answered", "closed"]) }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("support_tickets").update({ admin_reply: data.reply || null, status: data.status }).eq("id", data.id);
    if (error) throw new Error("تعذر حفظ الرد.");
    return { ok: true };
  });

export const adminStorage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase.from("assets").select("size,kind");
    if (error) throw new Error("تعذر قراءة التخزين.");
    const total = (data ?? []).reduce((s, a) => s + Number(a.size || 0), 0);
    return { files: data?.length ?? 0, bytes: total };
  });

// ---------- App icons (official App Store artwork) ----------
export const listAppIcons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("app_icons").select("*");
    if (error) throw new Error("تعذر تحميل مكتبة الأيقونات.");
    return data ?? [];
  });

export const refreshAppIcons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = APP_ICON_SOURCES.map((s) => s.trackId).join(",");
    const res = await fetch(`https://itunes.apple.com/lookup?id=${ids}&country=sa`);
    if (!res.ok) throw new Error(`تعذر الاتصال بمتجر التطبيقات (${res.status}).`);
    const j = (await res.json()) as { results: any[] };
    const report: { slug: string; ok: boolean; reason?: string }[] = [];
    for (const src of APP_ICON_SOURCES) {
      const r = j.results.find((x) => x.trackId === src.trackId);
      if (!r) { report.push({ slug: src.slug, ok: false, reason: "غير موجود في المتجر" }); continue; }
      if (String(r.sellerName).toLowerCase() !== src.seller.toLowerCase()) { report.push({ slug: src.slug, ok: false, reason: `الناشر غير مطابق: ${r.sellerName}` }); continue; }
      const art = String(r.artworkUrl512 || r.artworkUrl100 || "").replace(/\/\d+x\d+bb\.(jpg|png)$/, "/1024x1024bb.png");
      const { error } = await supabaseAdmin.from("app_icons").upsert({
        slug: src.slug, name_ar: src.nameAr, app_name: r.trackName, seller: r.sellerName, store_url: r.trackViewUrl,
        artwork_url: art, bundle_id: r.bundleId, version: r.version ?? null, updated_at: new Date().toISOString(),
      });
      report.push({ slug: src.slug, ok: !error, reason: error?.message });
    }
    return report;
  });

/** Returns an icon as a data URL so the browser canvas can draw it without CORS taint. */
export const getAppIconData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ slug: z.string().max(40) }))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("app_icons").select("*").eq("slug", data.slug).maybeSingle();
    if (!row) return { ok: false as const, reason: "الأيقونة غير محفوظة في المكتبة بعد. حدّث المكتبة من لوحة الإدارة." };
    if (!/^https:\/\/[a-z0-9.-]+\.mzstatic\.com\//.test(row.artwork_url)) return { ok: false as const, reason: "مصدر الأيقونة غير موثوق." };
    const r = await fetch(row.artwork_url);
    if (!r.ok) return { ok: false as const, reason: `تعذر تنزيل الأيقونة (${r.status}).` };
    const mime = (r.headers.get("content-type") ?? "image/png").split(";")[0]!;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ok: true as const, dataUrl: `data:${mime};base64,${btoa(bin)}`, source: row.store_url, appName: row.app_name };
  });
