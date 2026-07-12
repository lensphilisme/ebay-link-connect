import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAppSettings, DEFAULT_FONT } from "@/lib/app-settings.functions";
import { googleFontsCss2Url } from "@/lib/google-fonts";

const LINK_ID = "app-typography-font";

function applyFontFamily(family: string) {
  if (typeof document === "undefined") return;
  const stack = `"${family}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  document.documentElement.style.setProperty("--font-sans", stack);
  document.documentElement.style.setProperty("--font-display", stack);

  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  const href = googleFontsCss2Url(family);
  if (!link) {
    link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

/**
 * Loads the user's saved Google Font and applies it site-wide by updating
 * the --font-sans / --font-display CSS variables. Falls back to Jost until
 * the query resolves.
 */
export function FontProvider() {
  const { data: session } = useQuery({
    queryKey: ["auth-session-for-font"],
    queryFn: async () => (await supabase.auth.getSession()).data.session,
    staleTime: 60_000,
  });

  const { data } = useQuery({
    queryKey: ["app-settings", session?.user?.id ?? "anon"],
    enabled: !!session?.user,
    queryFn: () => getAppSettings(),
  });

  useEffect(() => {
    applyFontFamily(data?.typography_font || DEFAULT_FONT);
  }, [data?.typography_font]);

  return null;
}
