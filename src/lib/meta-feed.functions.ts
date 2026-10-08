import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMetaFeedInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { signFeedToken } = await import("./meta-feed.server");
    const token = await signFeedToken(userId);
    const { count } = await supabase
      .from("listing_drafts")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "approved", "pushed"]);
    return { path: `/api/public/meta-catalog/${userId}/${token}`, itemCount: count ?? 0 };
  });
