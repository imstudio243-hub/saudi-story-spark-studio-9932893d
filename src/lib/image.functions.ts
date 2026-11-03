import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { respond, generateImage, editImages, GatewayError, IMAGE_MODEL, toBase64, type ImageSize } from "./ai.server";

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "prompt", "size", "reply", "variants"],
  properties: {
    action: { type: "string", enum: ["generate", "edit", "reply"] },
    prompt: { type: "string" },
    size: { type: "string", enum: ["1024x1024", "1024x1536", "1536x1024"] },
    reply: { type: "string" },
    variants: { type: "integer", minimum: 1, maximum: 3 },
  },
};

const RULES = `You are iM STUDIO's creative design assistant (images and designs only, never video).
Decide what to do with the user's latest Arabic or English message, given the conversation and whether a current image exists.
- "generate": a brand-new image/design (ads, logos, Instagram posts, banners, covers, product shots, cartoon characters, realistic or artistic images). Write a detailed English image prompt. Any text that must appear in the image must be quoted exactly as the user wrote it (keep Arabic as Arabic).
- "edit": modify the CURRENT image (darker background, add lighting, change colours, remove an object, add text, add the uploaded logo, improve quality). Write an English edit prompt that names only the requested change and ends with an explicit list of what must stay unchanged (layout, product, text, colours, people). Never redesign.
- "reply": the user asks a question or the request is unclear; answer briefly in Arabic and ask what is needed.
If the user uploaded a logo/reference this turn, it is image #2 in an edit; describe its placement.
size: square for posts/logos, 1024x1536 for stories/posters, 1536x1024 for banners/covers, or keep the current image orientation for edits.
variants: 1 unless the user asks for several suggestions (max 3).
reply: short Arabic sentence describing what you are doing.`;

const input = z.object({
  projectId: z.string().uuid(),
  message: z.string().trim().min(1).max(3000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(30),
  currentImagePath: z.string().max(400).nullable(),
  uploadPath: z.string().max(400).nullable(),
  uploadIsBase: z.boolean(),
});

async function readStorage(supabase: any, path: string) {
  const { data, error } = await supabase.storage.from("studio").download(path);
  if (error || !data) throw new Error("تعذر قراءة الصورة المحفوظة.");
  return { b64: toBase64(await data.arrayBuffer()), mime: data.type || "image/png" };
}

export const studioTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(input)
  .handler(async ({ data, context }) => {
    const s = context.supabase;
    const { data: project } = await s.from("projects").select("id").eq("id", data.projectId).eq("user_id", context.userId).maybeSingle();
    if (!project) throw new Error("المشروع غير موجود.");

    const base = data.uploadIsBase && data.uploadPath ? data.uploadPath : data.currentImagePath;
    const ref = !data.uploadIsBase ? data.uploadPath : null;
    const decisionText = await respond({
      instructions: RULES,
      messages: [
        ...data.history.slice(-12),
        {
          role: "user",
          content: `Current image exists: ${base ? "yes" : "no"}. Uploaded logo/reference this turn: ${ref ? "yes" : "no"}.\nMessage: ${data.message}`,
        },
      ],
      schema: { name: "studio_decision", schema: decisionSchema },
    });
    const d = JSON.parse(decisionText) as { action: "generate" | "edit" | "reply"; prompt: string; size: ImageSize; reply: string; variants: number };
    if (d.action === "reply" || (d.action === "edit" && !base)) {
      return { reply: d.action === "edit" ? "لا توجد صورة حالية لتعديلها. ارفع صورة أو اطلب تصميمًا جديدًا." : d.reply, images: [] as string[], error: null };
    }

    const { data: job } = await s.from("generation_jobs").insert({ user_id: context.userId, project_id: data.projectId, kind: d.action === "edit" ? "image_edit" : "image", model: IMAGE_MODEL, status: "running", input: { prompt: d.prompt, size: d.size } }).select("id").single();
    const paths: string[] = [];
    try {
      const n = d.action === "edit" ? 1 : Math.min(3, Math.max(1, d.variants));
      for (let i = 0; i < n; i++) {
        let b64: string;
        if (d.action === "edit") {
          const imgs = [await readStorage(s, base!)];
          if (ref) imgs.push(await readStorage(s, ref));
          b64 = await editImages({ images: imgs, prompt: d.prompt, size: d.size });
        } else {
          b64 = await generateImage({ prompt: d.prompt, size: d.size });
        }
        const path = `${context.userId}/${data.projectId}/design-${Date.now()}-${i}.png`;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const up = await s.storage.from("studio").upload(path, bytes, { contentType: "image/png" });
        if (up.error) throw new Error("تعذر حفظ الصورة.");
        await s.from("assets").insert({ user_id: context.userId, project_id: data.projectId, kind: "image", mime: "image/png", size: bytes.length, source: "generated", storage_path: path, meta: { prompt: d.prompt, action: d.action } });
        paths.push(path);
      }
      if (job) {
        await s.from("generation_jobs").update({ status: "succeeded" }).eq("id", job.id);
        await s.from("usage_events").insert({ user_id: context.userId, job_id: job.id, service: "image", model: IMAGE_MODEL, unit: "image", units: paths.length });
      }
      return { reply: d.reply, images: paths, error: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : "فشل التوليد";
      if (job) await s.from("generation_jobs").update({ status: "failed", error: message }).eq("id", job.id);
      return { reply: "", images: paths, error: { status: e instanceof GatewayError ? e.status : 500, message } };
    }
  });
