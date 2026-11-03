import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { editImageMasked, respond, GatewayError } from "./ai.server";
import { fetchOfficialLogo } from "./official-logo.server";

const box = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "w", "h"],
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
};

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "question", "summary", "protected", "elements", "operations"],
  properties: {
    status: { type: "string", enum: ["ready", "clarify", "unsupported"] },
    question: { type: "string" },
    summary: { type: "string" },
    protected: { type: "array", items: { type: "string" } },
    elements: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["label", "box"], properties: { label: { type: "string" }, box } },
    },
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "target", "box", "company", "company_aliases", "domain", "text", "color", "source_color", "align", "scale", "fill_prompt"],
        properties: {
          kind: { type: "string", enum: ["add_logo", "add_text", "recolor", "remove", "replace_image", "resize"] },
          target: { type: "string" },
          box,
          company: { type: "string" },
          company_aliases: { type: "array", items: { type: "string" } },
          domain: { type: "string" },
          text: { type: "string" },
          color: { type: "string" },
          source_color: { type: "string" },
          align: { type: "string", enum: ["left", "center", "right"] },
          scale: { type: "number" },
          fill_prompt: { type: "string" },
        },
      },
    },
  },
};

export type EditOp = {
  kind: "add_logo" | "add_text" | "recolor" | "remove" | "replace_image" | "resize";
  target: string;
  box: { x: number; y: number; w: number; h: number };
  company: string;
  company_aliases: string[];
  domain: string;
  text: string;
  color: string;
  source_color: string;
  align: "left" | "center" | "right";
  scale: number;
  fill_prompt: string;
};
export type EditPlan = {
  status: "ready" | "clarify" | "unsupported";
  question: string;
  summary: string;
  protected: string[];
  elements: { label: string; box: EditOp["box"] }[];
  operations: EditOp[];
};

const RULES = `You are the instruction planner of iM STUDIO's STRICT EDIT MODE for advertising images.
You never redesign. You convert the user's Arabic or English command into the minimum list of local operations; everything not named by the user is protected and must not change.
Coordinates: normalized 0..1 relative to the image (x,y = top-left). Boxes must tightly cover the target, inside the image.
Operations:
- add_logo: one operation per company. Fill company (official English brand name), company_aliases (Arabic name and other spellings), domain (the company's real official website domain, e.g. tamara.co, tabby.ai, emkanfinance.com.sa, stc.com.sa). If the user said they uploaded the logo, set company to "uploaded". box = empty area where the logo goes; for several logos place equal-size boxes side by side with gaps, aligned as requested, avoiding existing text.
- add_text: text exactly as the user wrote it (never rewrite or correct), color hex, align, box sized for one line in an empty area at the requested position.
- recolor: box tightly around the element; source_color = its current dominant colour hex as seen; color = requested colour hex (gold = #D4AF37 unless specified).
- remove: box around the element to delete; fill_prompt = short English description of the background that should continue there.
- replace_image: box around the image to replace with the user's uploaded reference image.
- resize: box around the element; scale = factor (e.g. 0.8 for 20% smaller); fill_prompt describes the background behind it. Position is kept at the element centre.
Unused fields: empty string, empty array, scale 1, align "center".
protected: list (Arabic) of elements that must remain unchanged. elements: main detected elements with boxes. summary: Arabic one-line description of what will change.
status "clarify" only when ambiguity would change the result (e.g. there are two blue buttons, or the user asks to replace an image but none was uploaded); write question in Arabic and leave operations empty. status "unsupported" when the command requires a full redesign; explain in question.`;

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
