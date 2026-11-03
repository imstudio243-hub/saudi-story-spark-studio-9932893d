import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { editImageMasked, respond, GatewayError } from "./ai.server";
import { fetchOfficialLogo } from "./official-logo.server";

import { RULES, planSchema, type EditPlan } from "./ad-edit-plan";
export type { EditPlan, EditOp } from "./ad-edit-plan";

export const planAdEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      image: z.string().startsWith("data:image/").max(6_000_000),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      instruction: z.string().min(2).max(2000),
      clarification: z.string().max(1000).default(""),
      hasReference: z.boolean(),
      hasUploadedLogo: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const text = await respond({
      instructions: RULES,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: data.image },
            {
              type: "input_text",
              text: `Image size: ${data.width}x${data.height}px.\nUploaded reference image: ${data.hasReference ? "yes" : "no"}. Uploaded logo file: ${data.hasUploadedLogo ? "yes" : "no"}.\nCommand: ${data.instruction}${data.clarification ? `\nUser answer to your question: ${data.clarification}` : ""}`,
            },
          ],
        },
      ],
      schema: { name: "strict_edit_plan", schema: planSchema },
    });
    return JSON.parse(text) as EditPlan;
  });

export const findOfficialLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ company: z.string().min(1).max(100), domain: z.string().max(200), aliases: z.array(z.string().max(100)).max(8) }))
  .handler(async ({ data }) => fetchOfficialLogo(data.company, data.domain, data.aliases));

export const inpaintRegion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ image: z.string().max(8_000_000), mask: z.string().max(2_000_000), prompt: z.string().min(3).max(1500) }))
  .handler(async ({ data }) => {
    try {
      const b64 = await editImageMasked({
        imageB64: data.image,
        maskB64: data.mask,
        prompt: `${data.prompt}\nEdit ONLY the transparent mask area. Keep everything else pixel-identical. Do not add text, logos, decorations or new objects.`,
      });
      return { ok: true as const, image: b64 };
    } catch (e) {
      const status = e instanceof GatewayError ? e.status : 500;
      return { ok: false as const, status, message: e instanceof Error ? e.message : "فشل التحرير" };
    }
  });
