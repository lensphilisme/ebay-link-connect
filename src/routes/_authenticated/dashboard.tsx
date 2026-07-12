import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIntegrationStatus } from "@/lib/cj.functions";
import { getAccountsOverview } from "@/lib/accounts.functions";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Boxes, FileEdit, Tag, KeyRound, PackageSearch, TrendingUp, DollarSign, Eye } from "lucide-react";
import { AccountSwitcher } from "@/components/account-switcher";
import { useActiveAccountId } from "@/lib/active-account";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const statusFn = useServerFn(getIntegrationStatus);
  const overviewFn = useServerFn(getAccountsOverview);
  const [activeAccountId] = useActiveAccountId();
  const { data: status } = useQuery({ queryKey: ["integration-status"], queryFn: () => statusFn() });
  const { data: overview } = useQuery({ queryKey: ["accounts-overview"], queryFn: () => overviewFn(), refetchInterval: 60_000 });

  const { data: counts } = useQuery({
    queryKey: ["dashboard-counts", activeAccountId],
    queryFn: async () => {
      const draftsQ = supabase.from("listing_drafts").select("id,status,price,account_id", { count: "exact" });
      const listingsQ = supabase.from("ebay_listings").select("id,status,sales,views,price,account_id", { count: "exact" });
      const logsQ = supabase.from("activity_logs").select("id,message,level,created_at,account_id").order("created_at", { ascending: false }).limit(6);
      if (activeAccountId) {
        draftsQ.eq("account_id", activeAccountId);
        listingsQ.eq("account_id", activeAccountId);
        logsQ.eq("account_id", activeAccountId);
      }
      const [drafts, listings, logs] = await Promise.all([draftsQ, listingsQ, logsQ]);
      const draftRows = drafts.data || [];
      const listingRows = listings.data || [];
      return {
        draftsTotal: drafts.count ?? draftRows.length,
        draftsPending: draftRows.filter((d) => d.status === "pending").length,
        draftsFailed: draftRows.filter((d) => d.status === "failed").length,
        listingsTotal: listings.count ?? listingRows.length,
        listingsActive: listingRows.filter((l) => l.status === "active").length,
        totalSales: listingRows.reduce((s, l) => s + (l.sales || 0), 0),
        totalViews: listingRows.reduce((s, l) => s + (l.views || 0), 0),
        gmv: listingRows.reduce((s, l) => s + Number(l.price || 0) * (l.sales || 0), 0),
        logs: logs.data || [],
      };
    },
    refetchInterval: 30_000,
  });

  const integrations = [status?.cj.connected, status?.ebay.connected, true].filter(Boolean).length;
  const accountsList = overview?.accounts ?? [];
  const activeAccount = activeAccountId ? accountsList.find((a: any) => a.id === activeAccountId) : null;

  const stats: {
    Icon: typeof FileEdit;
    label: string;
    v: string | number;
    hint: string;
    tint: string;
  }[] = [
    { Icon: DollarSign, label: "Revenue (GMV)", v: `$${(counts?.gmv ?? 0).toFixed(2)}`, hint: `${counts?.totalSales ?? 0} units sold`, tint: "from-emerald-500/20 to-emerald-500/5 text-emerald-500 ring-emerald-500/20" },
    { Icon: Tag, label: "Active listings", v: counts?.listingsActive ?? 0, hint: `${counts?.listingsTotal ?? 0} tracked`, tint: "from-violet-500/20 to-violet-500/5 text-violet-500 ring-violet-500/20" },
    { Icon: FileEdit, label: "Drafts pending", v: counts?.draftsPending ?? 0, hint: `${counts?.draftsFailed ?? 0} failed`, tint: "from-amber-500/20 to-amber-500/5 text-amber-500 ring-amber-500/20" },
    { Icon: Eye, label: "Watchers", v: counts?.totalViews ?? 0, hint: `${integrations}/3 integrations`, tint: "from-sky-500/20 to-sky-500/5 text-sky-500 ring-sky-500/20" },
  ];

  return (
    <AppShell
      title={activeAccount ? activeAccount.account_name : "Dashboard"}
      subtitle={activeAccount ? "Single-account view" : "Every connected eBay seller in one place"}
      actions={<AccountSwitcher />}
    >
      {/* Luxury stat strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card
            key={s.label}
            className={`relative overflow-hidden border-0 ring-1 ${s.tint.split(" ").pop()} bg-gradient-to-br ${s.tint.split(" ").slice(0, 2).join(" ")} shadow-[var(--shadow-card)]`}
          >
            <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/5 blur-2xl" />
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 p-3 sm:p-4">
              <CardTitle className="text-xs sm:text-sm font-medium text-foreground/70">{s.label}</CardTitle>
              <div className={`h-8 w-8 rounded-lg bg-background/60 backdrop-blur flex items-center justify-center ${s.tint.split(" ").find((c) => c.startsWith("text-"))}`}>
                <s.Icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
              <div className="text-2xl sm:text-3xl font-bold tracking-tight">{s.v}</div>
              <div className="text-xs text-foreground/60 mt-1">{s.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Account grid — only when viewing ALL accounts and more than one exists */}
      {!activeAccountId && accountsList.length > 1 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Accounts at a glance</h2>
            <span className="text-xs text-muted-foreground">{accountsList.length} connected</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accountsList.map((a: any) => (
              <Card key={a.id} className="relative overflow-hidden shadow-[var(--shadow-card)] border-border/60 hover:border-primary/50 transition-colors">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-violet-500 to-emerald-500" />
                <CardHeader className="pb-2 p-3 sm:p-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold truncate">{a.account_name}</CardTitle>
                    {!a.is_active && <span className="text-[10px] rounded-full bg-muted text-muted-foreground px-2 py-0.5">paused</span>}
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0 grid grid-cols-2 gap-2 text-xs">
                  <Metric label="Active" value={a.listings_active} />
                  <Metric label="Sold" value={a.units_sold} />
                  <Metric label="Drafts" value={a.drafts_pending} />
                  <Metric label="GMV" value={`$${Number(a.gmv || 0).toFixed(0)}`} accent />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 shadow-[var(--shadow-card)]">
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(counts?.logs || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet. Push a draft to see events here.</p>
            ) : counts!.logs.map((l: any) => (
              <div key={l.id} className="flex items-start gap-3 text-sm border-b border-border/60 last:border-0 py-2">
                <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${l.level === "success" ? "bg-emerald-500" : l.level === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
                <div className="flex-1">
                  <div>{l.message}</div>
                  <div className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)] bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Button asChild className="w-full justify-between"><Link to="/products">Search CJ <PackageSearch className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/drafts">Review drafts <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/optimizer">Run optimizer <TrendingUp className="h-4 w-4" /></Link></Button>
            <Button asChild variant="ghost" className="w-full justify-between"><Link to="/settings">Integrations & rules <Boxes className="h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-md px-2 py-1.5 ${accent ? "bg-emerald-500/10 text-emerald-600" : "bg-muted/50"}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
