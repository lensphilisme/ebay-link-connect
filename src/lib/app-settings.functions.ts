import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const DEFAULT_FONT = "Jost";
export const DEFAULT_APP_URL = "https://ebay-link-connect.lovable.app";

export const getAppSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase.from("app_settings") as any)
      .select("typography_font, app_url")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: created, error: insErr } = await (supabase.from("app_settings") as any)
        .insert({ user_id: userId, typography_font: DEFAULT_FONT, app_url: DEFAULT_APP_URL })
        .select("typography_font, app_url")
        .single();
      if (insErr) throw insErr;
      return {
        typography_font: created.typography_font || DEFAULT_FONT,
        app_url: created.app_url || DEFAULT_APP_URL,
      };
    }
    return {
      typography_font: data.typography_font || DEFAULT_FONT,
      app_url: data.app_url || DEFAULT_APP_URL,
    };
  });

export const setTypographyFont = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { font: string }) =>
    z.object({ font: z.string().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase.from("app_settings") as any)
      .upsert(
        { user_id: userId, typography_font: data.font },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    return { ok: true, typography_font: data.font };
  });

export const setAppUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string }) =>
    z
      .object({
        url: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .refine((v) => /^https?:\/\/.+/i.test(v), "Must start with http(s)://"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const clean = data.url.replace(/\/+$/, "");
    const { error } = await (supabase.from("app_settings") as any)
      .upsert(
        { user_id: userId, app_url: clean },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    return { ok: true, app_url: clean };
  });
