import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { deleteMyAccount, getMyAccount } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "الملف الشخصي — iM STUDIO" }, { name: "description", content: "بيانات حسابك واشتراكك ونقاطك ومشاريعك." }, { property: "og:title", content: "الملف الشخصي — iM STUDIO" }, { property: "og:description", content: "إعدادات الحساب في iM STUDIO." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Profile,
});

type Account = Awaited<ReturnType<typeof getMyAccount>>;

function Profile() {
  const [acc, setAcc] = useState<Account | null>(null);
  const [email, setEmail] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState("");
  const qc = useQueryClient();
  const nav = useNavigate();

  async function load() {
    const a = await getMyAccount();
    setAcc(a);
    setName(a.profile?.display_name ?? "");
    if (a.profile?.avatar_url) {
      const { data } = await supabase.storage.from("studio").createSignedUrl(a.profile.avatar_url, 3600);
      setAvatar(data?.signedUrl ?? null);
    }
  }
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setEmail(data.user?.email ?? ""); setCreatedAt(data.user?.created_at ?? ""); });
    load().catch((e) => toast.error(e.message));
  }, []);

  async function saveName() {
    setBusy("name");
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").update({ display_name: name.trim() }).eq("id", u.user!.id);
    setBusy("");
    error ? toast.error("تعذر الحفظ") : toast.success("تم حفظ الاسم");
  }

  async function uploadAvatar(f: File) {
    if (!f.type.startsWith("image/")) { toast.error("اختر صورة"); return; }
    setBusy("avatar");
    const { data: u } = await supabase.auth.getUser();
    const path = `${u.user!.id}/avatar-${Date.now()}.${f.type.split("/")[1] || "png"}`;
    const up = await supabase.storage.from("studio").upload(path, f, { contentType: f.type });
    if (!up.error) await supabase.from("profiles").update({ avatar_url: path }).eq("id", u.user!.id);
    setBusy("");
    if (up.error) { toast.error("تعذر رفع الصورة"); return; }
    toast.success("تم تحديث الصورة");
    load();
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setBusy("pw");
    const { error } = await supabase.auth.updateUser({ password: pw, current_password: cur } as any);
    setBusy("");
    if (error) { toast.error(error.message); return; }
    setCur(""); setPw("");
    toast.success("تم تغيير كلمة المرور");
  }

  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

  async function del() {
    const c = prompt("سيُحذف حسابك وكل مشاريعك وملفاتك نهائيًا. اكتب «حذف» للتأكيد:");
    if (c !== "حذف") return;
    setBusy("del");
    try {
      await deleteMyAccount({ data: { confirm: "حذف" } });
      await signOut();
    } catch (e: any) { toast.error(e.message); setBusy(""); }
  }

  if (!acc) return <div className="grid place-items-center py-20 text-muted-foreground"><Loader2 className="animate-spin" /></div>;
  const isAdmin = acc.roles.includes("admin");

  return (
    <div className="space-y-6">
      <section className="glass flex flex-col items-center gap-4 rounded-3xl p-6 text-center sm:flex-row sm:text-right">
        <label className="relative grid h-24 w-24 cursor-pointer place-items-center overflow-hidden rounded-full bg-accent">
          {avatar ? <img src={avatar} alt="الصورة الشخصية" className="h-full w-full object-cover" /> : <Camera className="h-8 w-8 text-muted-foreground" />}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
          {busy === "avatar" && <Loader2 className="absolute animate-spin" />}
        </label>
        <div>
          <h1 className="text-2xl font-bold">{acc.profile?.display_name || "بدون اسم"}</h1>
          <p dir="ltr" className="text-sm text-muted-foreground">{email}</p>
          <p className="text-xs text-muted-foreground">عضو منذ {createdAt && new Date(createdAt).toLocaleDateString("ar-SA")}{isAdmin && " · مدير أعلى"}</p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="الباقة" value={acc.profile?.plan === "free" ? "مجانية" : acc.profile?.plan ?? "—"} />
        <Stat label="النقاط" value={Number(acc.profile?.credits ?? 0).toLocaleString("ar-SA")} />
        <Stat label="التصميمات" value={acc.designs.toLocaleString("ar-SA")} />
        <Stat label="المشاريع" value={acc.projects.length.toLocaleString("ar-SA")} />
      </div>

      <section className="glass space-y-3 rounded-2xl p-5">
        <h2 className="font-bold">الاسم</h2>
        <div className="flex gap-2"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /><Button variant="luxe" onClick={saveName} disabled={busy === "name"}>حفظ</Button></div>
      </section>

      <section className="glass space-y-3 rounded-2xl p-5">
        <h2 className="font-bold">تغيير كلمة المرور</h2>
        <form onSubmit={changePw} className="space-y-3">
          <div className="space-y-1"><Label htmlFor="cur">الحالية</Label><Input id="cur" type="password" dir="ltr" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="new">الجديدة</Label><Input id="new" type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <Button variant="luxe" disabled={busy === "pw"}>تغيير</Button>
        </form>
      </section>

      <section className="glass space-y-2 rounded-2xl p-5">
        <h2 className="font-bold">سجل العمليات</h2>
        {acc.jobs.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد عمليات بعد.</p> : acc.jobs.map((j) => (
          <div key={j.id} className="flex justify-between border-b border-border/50 py-2 text-sm last:border-0">
            <span>{kindAr(j.kind)} · {new Date(j.created_at).toLocaleString("ar-SA")}</span>
            <span className={j.status === "failed" ? "text-destructive" : "text-gold"} title={j.error ?? ""}>{statusAr(j.status)}</span>
          </div>
        ))}
      </section>

      <section className="glass space-y-2 rounded-2xl p-5">
        <h2 className="font-bold">مشاريعي</h2>
        {acc.projects.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد مشاريع.</p> : acc.projects.slice(0, 10).map((p) => (
          <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="block border-b border-border/50 py-2 text-sm last:border-0 hover:text-gold">{p.name}</Link>
        ))}
      </section>

      <section className="flex flex-wrap gap-2">
        <Button asChild variant="glass"><Link to="/help">المساعدة والدعم</Link></Button>
        <Button asChild variant="glass"><Link to="/privacy">سياسة التطبيق والخصوصية</Link></Button>
        <Button variant="glass" onClick={signOut}><LogOut /> تسجيل الخروج</Button>
        <Button variant="destructive" onClick={del} disabled={busy === "del"}><Trash2 /> حذف الحساب والبيانات</Button>
      </section>
    </div>
  );
}

const kindAr = (k: string) => ({ image: "توليد صورة", image_edit: "تعديل صورة", video: "فيديو", voice: "صوت", strict_edit: "تحرير إعلان" } as Record<string, string>)[k] ?? k;
const statusAr = (s: string) => ({ succeeded: "نجح", completed: "مكتمل", failed: "فشل", running: "قيد التنفيذ", queued: "بالانتظار" } as Record<string, string>)[s] ?? s;

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="glass rounded-2xl p-4 text-center"><div className="text-brand text-xl font-bold">{value}</div><div className="mt-1 text-xs text-muted-foreground">{label}</div></div>;
}
