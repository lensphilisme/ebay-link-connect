// Integration-managed pattern: client-only gate that bounces to /auth.
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw redirect({ to: "/auth" });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (!refreshed.session?.user) throw redirect({ to: "/auth" });
      return { user: refreshed.session.user };
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
