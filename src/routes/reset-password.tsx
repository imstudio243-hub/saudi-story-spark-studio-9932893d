import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "تعيين كلمة مرور جديدة — iM STUDIO" },
      { name: "description", content: "عيّن كلمة مرور جديدة لحسابك في iM STUDIO." },
      { property: "og:title", content: "تعيين كلمة مرور جديدة — iM STUDIO" },
      { property: "og:description", content: "استعادة الوصول إلى حسابك بأمان." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((e) => { if (e === "PASSWORD_RECOVERY" || e === "SIGNED_IN") setReady(true); });
    supabase.auth.getSession().then(({ data: s }) => { if (s.session) setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم تغيير كلمة المرور");
    nav({ to: "/dashboard", replace: true });
  }

  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="glass w-full max-w-sm rounded-3xl p-7 shadow-luxe">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold">كلمة مرور جديدة</h1>
        {!ready ? (
          <p className="mt-4 text-sm text-muted-foreground">افتح هذه الصفحة من رابط الاستعادة المرسل إلى بريدك.</p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="npw">كلمة المرور الجديدة</Label>
              <Input id="npw" type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <Button type="submit" variant="luxe" className="h-11 w-full" disabled={busy}>حفظ</Button>
          </form>
        )}
      </div>
    </div>
  );
}
