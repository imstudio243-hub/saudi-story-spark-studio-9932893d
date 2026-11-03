import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus, Loader2, Palette, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { studioTurn } from "@/lib/image.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/studio")({
  validateSearch: z.object({ project: z.string().uuid().optional() }),
  head: () => ({ meta: [{ title: "المصمم الذكي — iM STUDIO" }, { name: "description", content: "أنشئ وعدّل الصور والتصميمات الإعلانية بالمحادثة." }, { property: "og:title", content: "المصمم الذكي — iM STUDIO" }, { property: "og:description", content: "توليد وتعديل الصور بالذكاء الاصطناعي." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Studio,
});

type Msg = { role: "user" | "assistant"; content: string; images?: string[]; upload?: string; error?: string };

function Studio() {
  const { project } = Route.useSearch();
  const nav = useNavigate();
  const [projectId, setProjectId] = useState<string | null>(project ?? null);
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [asBase, setAsBase] = useState(true);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    supabase.from("projects").select("id,name").eq("kind", "design").order("updated_at", { ascending: false }).then(({ data }) => setSessions(data ?? []));
  }, [projectId]);

  useEffect(() => {
    setProjectId(project ?? null);
    if (!project) { setMsgs([]); return; }
    supabase.from("projects").select("data").eq("id", project).maybeSingle().then(({ data }) => setMsgs(((data?.data as any)?.messages as Msg[]) ?? []));
  }, [project]);

  useEffect(() => {
    const paths = msgs.flatMap((m) => [...(m.images ?? []), ...(m.upload ? [m.upload] : [])]).filter((p) => !urls[p]);
    if (!paths.length) return;
    supabase.storage.from("studio").createSignedUrls(paths, 3600).then(({ data }) => {
      const next: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
      setUrls((u) => ({ ...u, ...next }));
    });
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const currentImage = [...msgs].reverse().find((m) => m.images?.length)?.images?.[0] ?? [...msgs].reverse().find((m) => m.upload)?.upload ?? null;

  async function ensureProject(title: string) {
    if (projectId) return projectId;
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("projects").insert({ user_id: u.user!.id, name: title.slice(0, 60) || "تصميم جديد", kind: "design", data: { messages: [] } }).select("id").single();
    if (error) throw new Error("تعذر إنشاء جلسة التصميم.");
    setProjectId(data.id);
    nav({ to: "/studio", search: { project: data.id }, replace: true });
    return data.id;
  }

  async function save(pid: string, list: Msg[]) {
    await supabase.from("projects").update({ data: { messages: list }, updated_at: new Date().toISOString() }).eq("id", pid);
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      const pid = await ensureProject(message);
      const { data: u } = await supabase.auth.getUser();
      let uploadPath: string | null = null;
      if (file) {
        uploadPath = `${u.user!.id}/${pid}/upload-${Date.now()}.${file.type.split("/")[1] || "png"}`;
        const up = await supabase.storage.from("studio").upload(uploadPath, file, { contentType: file.type });
        if (up.error) throw new Error("تعذر رفع الصورة.");
        await supabase.from("assets").insert({ user_id: u.user!.id, project_id: pid, kind: "image", mime: file.type, size: file.size, source: "uploaded", storage_path: uploadPath });
      }
      const userMsg: Msg = uploadPath ? { role: "user", content: message, upload: uploadPath } : { role: "user", content: message };
      const list = [...msgs, userMsg];
      setMsgs(list); setText(""); setFile(null);
      const r = await studioTurn({
        data: {
          projectId: pid,
          message,
          history: msgs.map((m) => ({ role: m.role, content: (m.content + (m.images?.length ? " [صورة مولدة]" : "")).slice(0, 4000) })),
          currentImagePath: currentImage,
          uploadPath,
          uploadIsBase: asBase,
        },
      });
      const reply: Msg = r.error
        ? { role: "assistant", content: "", error: r.error.message, images: r.images }
        : { role: "assistant", content: r.reply, images: r.images };
      const final = [...list, reply];
      setMsgs(final);
      await save(pid, final);
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ");
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Palette className="text-gold" /> المصمم الذكي</h1>
        <div className="flex gap-2">
          <select className="glass h-9 max-w-40 rounded-xl px-2 text-sm" value={projectId ?? ""} onChange={(e) => nav({ to: "/studio", search: { project: e.target.value || undefined } })}>
            <option value="">جلسة جديدة</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button size="icon" variant="glass" aria-label="جلسة جديدة" onClick={() => nav({ to: "/studio", search: {} })}><Plus /></Button>
        </div>
      </div>

      <div className="flex-1 space-y-4">
        {msgs.length === 0 && (
          <div className="glass rounded-2xl p-6 text-sm leading-loose text-muted-foreground">
            اكتب ما تريد تصميمه، مثل: «صمم لي إعلانًا فاخرًا لعطر بخلفية سوداء وذهبية». بعد ظهور الصورة اكتب التعديل: «اجعل الخلفية أغمق وأضف إضاءة ذهبية حول العطر». يمكنك رفع صورة لتعديلها أو رفع شعار لإضافته.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "mr-auto max-w-[85%] rounded-2xl bg-primary p-3 text-primary-foreground" : "max-w-full"}>
            {m.upload && urls[m.upload] && <img src={urls[m.upload]} alt="صورة مرفوعة" className="mb-2 max-h-40 rounded-xl" />}
            {m.content && <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>}
            {m.error && <p className="rounded-xl border border-destructive/40 p-3 text-sm text-destructive">تعذر التنفيذ: {m.error}</p>}
            {!!m.images?.length && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {m.images.map((p) => (
                  <div key={p} className="relative">
                    {urls[p] ? <img src={urls[p]} alt="تصميم مولد" className="w-full rounded-2xl shadow-luxe" /> : <div className="aspect-square animate-pulse rounded-2xl bg-accent" />}
                    {urls[p] && <a href={urls[p]} download className="glass absolute bottom-2 left-2 rounded-xl p-2" aria-label="تنزيل"><Download className="h-4 w-4" /></a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التصميم… قد يستغرق دقيقة</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="glass sticky bottom-24 space-y-2 rounded-2xl p-3 md:bottom-3">
        {file && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>📎 {file.name}</span>
            <label className="flex items-center gap-1"><input type="radio" checked={asBase} onChange={() => setAsBase(true)} /> صورة للتعديل</label>
            <label className="flex items-center gap-1"><input type="radio" checked={!asBase} onChange={() => setAsBase(false)} disabled={!currentImage} /> شعار/مرجع يُضاف للصورة الحالية</label>
            <button type="button" className="text-destructive" onClick={() => setFile(null)}>إزالة</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl hover:bg-accent" aria-label="رفع صورة">
            <ImagePlus className="h-5 w-5" />
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setAsBase(!currentImage); } e.target.value = ""; }} />
          </label>
          <Textarea ref={taRef} autoFocus rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="صف التصميم أو التعديل…" className="min-h-10 resize-none" />
          <Button type="submit" size="icon" variant="luxe" disabled={busy || !text.trim()} aria-label="إرسال">{busy ? <Loader2 className="animate-spin" /> : <Send />}</Button>
        </div>
      </form>
    </div>
  );
}
