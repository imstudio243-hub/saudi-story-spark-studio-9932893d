import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LifeBuoy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createTicket } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({ meta: [{ title: "المساعدة — iM STUDIO" }, { name: "description", content: "شرح استخدام iM STUDIO والأسئلة الشائعة وطلبات الدعم." }, { property: "og:title", content: "المساعدة — iM STUDIO" }, { property: "og:description", content: "شرح الاستخدام والدعم الفني." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Help,
});

const FAQ = [
  ["كيف أنشئ صورة؟", "افتح «المصمم» واكتب وصف التصميم (مثل: إعلان فاخر لعطر بخلفية سوداء وذهبية). تظهر الصورة داخل المحادثة وتُحفظ في مشروعك."],
  ["كيف أعدّل صورة؟", "في «المصمم» اكتب التعديل مباشرة بعد ظهور الصورة، أو ارفع صورة من معرض الهاتف ثم اكتب ما تريد. يعدّل المساعد الصورة الحالية مع المحافظة على بقية العناصر."],
  ["ما الفرق بين المصمم ومحرر الإعلانات؟", "المصمم ينشئ ويعدّل بحرية. محرر الإعلانات صارم: يغيّر فقط العنصر الذي تذكره ويقارن البكسلات بالأصل ويخبرك إن تغيّر شيء خارج المنطقة المطلوبة."],
  ["كيف أضيف أيقونات تمارا وتابي وغيرها؟", "في محرر الإعلانات اكتب مثلًا: «أضف أيقونات تمارا وتابي وإمكان ونيو ومدفوع وstc أسفل الإعلان متساوية الحجم». تُستخدم الأيقونات الأصلية من متجر التطبيقات فقط."],
  ["الاشتراكات والنقاط", "تظهر باقتك ورصيدك في الملف الشخصي. يحدد المدير الباقات والأرصدة. الدفع الإلكتروني غير مفعّل بعد."],
  ["هل يرى أحد مشاريعي؟", "لا. ملفاتك ومشاريعك خاصة بحسابك فقط، والمدير يطّلع عليها لأغراض الدعم والإدارة."],
];

function Help() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => supabase.auth.getUser().then(({ data }) => data.user && supabase.from("support_tickets").select("*").eq("user_id", data.user.id).order("created_at", { ascending: false }).then(({ data: t }) => setTickets(t ?? [])));
  useEffect(() => { load(); }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createTicket({ data: { subject, body } });
      toast.success("تم إرسال طلبك، سيظهر الرد هنا.");
      setSubject(""); setBody(""); load();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">المساعدة والدعم</h1>
      <section className="space-y-3">
        {FAQ.map(([q, a]) => (
          <details key={q} className="glass rounded-2xl p-4">
            <summary className="cursor-pointer font-bold">{q}</summary>
            <p className="mt-2 text-sm leading-loose text-muted-foreground">{a}</p>
          </details>
        ))}
        <p className="text-sm text-muted-foreground">اقرأ <Link to="/privacy" className="text-gold underline">سياسة التطبيق والخصوصية</Link>.</p>
      </section>
      <section className="glass space-y-4 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 font-bold"><LifeBuoy className="h-5 w-5 text-gold" /> الإبلاغ عن مشكلة أو طلب دعم</h2>
        <form onSubmit={send} className="space-y-3">
          <Input placeholder="عنوان الطلب" required minLength={3} maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Textarea placeholder="اشرح المشكلة بالتفصيل" required minLength={10} maxLength={4000} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          <Button variant="luxe" disabled={busy}>{busy && <Loader2 className="animate-spin" />} إرسال</Button>
        </form>
      </section>
      <section className="space-y-2">
        <h2 className="font-bold">طلباتي</h2>
        {tickets.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد طلبات.</p> : tickets.map((t) => (
          <div key={t.id} className="glass rounded-2xl p-4 text-sm">
            <div className="flex justify-between"><b>{t.subject}</b><span className="text-gold">{t.status === "open" ? "مفتوح" : t.status === "answered" ? "تم الرد" : "مغلق"}</span></div>
            <p className="mt-2 text-muted-foreground">{t.body}</p>
            {t.admin_reply && <p className="mt-3 rounded-xl bg-accent p-3">رد الدعم: {t.admin_reply}</p>}
          </div>
        ))}
      </section>
    </div>
  );
}
