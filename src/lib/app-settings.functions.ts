import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const DEFAULT_FONT = "Jost";

export const getAppSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("app_settings")
      .select("typography_font")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: created, error: insErr } = await supabase
        .from("app_settings")
        .insert({ user_id: userId, typography_font: DEFAULT_FONT })
        .select("typography_font")
        .single();
      if (insErr) throw insErr;
      return { typography_font: created.typography_font };
    }
    return { typography_font: data.typography_font || DEFAULT_FONT };
  });

export const setTypographyFont = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { font: string }) =>
    z.object({ font: z.string().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { user_id: userId, typography_font: data.font },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    return { ok: true, typography_font: data.font };
  });
