import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIntegrationStatus } from "@/lib/cj.functions";
import { getLiveAccountsOverview } from "@/lib/ebay-live.functions";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Boxes, FileEdit, Tag, PackageSearch, TrendingUp, Eye, ShoppingCart, DollarSign, BarChart3, Megaphone, AlertCircle, CheckCircle2 } from "lucide-react";
import { AccountSwitcher } from "@/components/account-switcher";
import { useActiveAccountId } from "@/lib/active-account";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: DashboardPage });

function DashboardPage() {
  const statusFn = useServerFn(getIntegrationStatus);
  const overviewFn = useServerFn(getLiveAccountsOverview);
  const [activeAccountId] = useActiveAccountId();
  const { data: status } = useQuery({ queryKey: ["integration-status"], queryFn: () => statusFn() });
  const { data: overview } = useQuery({ queryKey: ["live-accounts-overview"], queryFn: () => overviewFn(), refetchInterval: 120_000, staleTime: 60_000 });

  const { data: draftCounts } = useQuery({
    queryKey: ["dashboard-drafts", activeAccountId],
    queryFn: async () => {
      let q = supabase.from("listing_drafts").select("id,status", { count: "exact" });
      if (activeAccountId) q = q.eq("account_id", activeAccountId);
      const { data, count } = await q;
      const rows = data || [];
      return {
        total: count ?? rows.length,
        pending: rows.filter((d) => d.status === "pending").length,
        failed: rows.filter((d) => d.status === "failed").length,
      };
    },
    refetchInterval: 60_000,
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["dashboard-logs", activeAccountId],
    queryFn: async () => {
      let q = supabase.from("activity_logs").select("id,message,level,created_at,account_id").order("created_at", { ascending: false }).limit(6);
      if (activeAccountId) q = q.eq("account_id", activeAccountId);
      const { data } = await q;
      return data || [];
    },
    refetchInterval: 30_000,
  });

  const accountsList = overview?.accounts ?? [];
  const activeAccount = activeAccountId ? accountsList.find((a: any) => a.id === activeAccountId) : null;
  const scope = activeAccount ? [activeAccount] : accountsList;
  const totals = scope.reduce((acc: any, a: any) => {
    acc.listings += a.listings_active || 0;
    acc.watchers += a.watchers || 0;
    acc.sold += a.units_sold || 0;
    return acc;
  }, { listings: 0, watchers: 0, sold: 0 });

  const stats = [
    { Icon: Tag, label: "Live", v: totals.listings, tint: "violet" },
    { Icon: Eye, label: "Watchers", v: totals.watchers, tint: "sky" },
    { Icon: ShoppingCart, label: "Sold", v: totals.sold, tint: "emerald" },
    { Icon: FileEdit, label: "Drafts", v: draftCounts?.pending ?? 0, hint: draftCounts?.failed ? `${draftCounts.failed} failed` : undefined, tint: "amber" },
  ];

  return (
    <AppShell
      title={activeAccount ? activeAccount.account_name : "Dashboard"}
      subtitle={activeAccount ? "Single-account view" : `${accountsList.length} account${accountsList.length === 1 ? "" : "s"} · live from eBay`}
      actions={<AccountSwitcher />}
    >
      {/* Compact luxury stat strip */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {stats.map((s) => (
          <StatChip key={s.label} {...s} />
        ))}
      </div>

      {/* Compact account row (only in all-accounts view with multiple accounts) */}
      {!activeAccountId && accountsList.length > 1 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accounts</h2>
            <span className="text-[10px] text-muted-foreground">{accountsList.length} connected</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {accountsList.map((a: any) => (
              <Card key={a.id} className="border-border/60 hover:border-primary/50 transition-colors">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {a.connected ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      <span className="font-medium text-sm truncate">{a.account_name}</span>
                    </div>
                    {!a.is_active && <span className="text-[10px] rounded-full bg-muted text-muted-foreground px-1.5 py-0.5">paused</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                    <MiniStat Icon={Tag} v={a.listings_active} />
                    <MiniStat Icon={Eye} v={a.watchers} />
                    <MiniStat Icon={FileEdit} v={a.drafts_pending} tint="amber" />
                  </div>
                  {a.live_error && <p className="mt-1 text-[10px] text-destructive truncate" title={a.live_error}>{a.live_error}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Content grid */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Recent activity</div>
            {logs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Nothing yet.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {logs.map((l: any) => (
                  <div key={l.id} className="flex items-start gap-2 py-1.5 text-xs">
                    <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${l.level === "success" ? "bg-emerald-500" : l.level === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{l.message}</div>
                      <div className="text-[10px] text-muted-foreground">{new Date(l.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-primary/8 via-violet-500/5 to-transparent">
          <CardContent className="p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Quick actions</div>
            <div className="grid grid-cols-2 gap-1.5">
              <QuickLink to="/products" Icon={PackageSearch} label="Search CJ" />
              <QuickLink to="/drafts" Icon={FileEdit} label="Drafts" />
              <QuickLink to="/optimizer" Icon={TrendingUp} label="Optimizer" />
              <QuickLink to="/orders" Icon={ShoppingCart} label="Orders" />
              <QuickLink to="/finances" Icon={DollarSign} label="Finances" />
              <QuickLink to="/analytics" Icon={BarChart3} label="Analytics" />
              <QuickLink to="/marketing" Icon={Megaphone} label="Marketing" />
              <QuickLink to="/settings" Icon={Boxes} label="Settings" />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

const TINTS: Record<string, string> = {
  violet: "from-violet-500/25 to-violet-500/5 text-violet-500 ring-violet-500/20",
  sky: "from-sky-500/25 to-sky-500/5 text-sky-500 ring-sky-500/20",
  emerald: "from-emerald-500/25 to-emerald-500/5 text-emerald-500 ring-emerald-500/20",
  amber: "from-amber-500/25 to-amber-500/5 text-amber-500 ring-amber-500/20",
};

function StatChip({ Icon, label, v, hint, tint }: { Icon: any; label: string; v: any; hint?: string; tint: string }) {
  const t = TINTS[tint];
  const iconColor = t.split(" ").find((c) => c.startsWith("text-"));
  const ring = t.split(" ").find((c) => c.startsWith("ring-"));
  const grad = t.split(" ").filter((c) => c.startsWith("from-") || c.startsWith("to-")).join(" ");
  return (
    <Card className={`relative overflow-hidden border-0 ring-1 ${ring} bg-gradient-to-br ${grad}`}>
      <div className="absolute -right-3 -top-3 h-14 w-14 rounded-full bg-white/5 blur-xl" />
      <CardContent className="p-2.5 sm:p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground/60">
          <Icon className={`h-3 w-3 ${iconColor}`} /> {label}
        </div>
        <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">{v}</div>
        {hint && <div className="text-[10px] text-foreground/60 truncate">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function MiniStat({ Icon, v, tint }: { Icon: any; v: any; tint?: string }) {
  return (
    <div className={`rounded-md px-1.5 py-1 flex items-center gap-1 ${tint === "amber" ? "bg-amber-500/10 text-amber-600" : "bg-muted/50"}`}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="font-semibold tabular-nums">{v}</span>
    </div>
  );
}

function QuickLink({ to, Icon, label }: { to: string; Icon: any; label: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="justify-start gap-1.5 h-8 text-xs">
      <Link to={to as any}><Icon className="h-3.5 w-3.5" />{label}</Link>
    </Button>
  );
}
