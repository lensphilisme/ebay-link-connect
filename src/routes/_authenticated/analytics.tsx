import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AccountScopedPanel } from "@/components/account-scoped-panel";
import { useServerFn } from "@tanstack/react-start";
import { getEbayTrafficReportFn } from "@/lib/ebay-live.functions";
import { Card } from "@/components/ui/card";
import { BarChart3, Eye, MousePointerClick, Percent } from "lucide-react";

export const Route = createFileRoute("/_authenticated/analytics")({ component: AnalyticsPage });

function AnalyticsPage() {
  const fn = useServerFn(getEbayTrafficReportFn);
  return (
    <AppShell title="Analytics" subtitle="30-day traffic report">
      <AccountScopedPanel
        queryKey="ebay-analytics"
        fetcher={(accountId) => fn({ data: { accountId } })}
        empty="Pick a connected account to see analytics."
      >
        {(data: any) => {
          const records: any[] = data.records || [];
          const max = Math.max(1, ...records.map((r) => Number(r.LISTING_IMPRESSION_TOTAL || 0)));
          const totals = records.reduce((acc: any, r: any) => {
            acc.impr += Number(r.LISTING_IMPRESSION_TOTAL || 0);
            acc.views += Number(r.LISTING_VIEWS_TOTAL || 0);
            return acc;
          }, { impr: 0, views: 0 });
          const ctr = totals.impr ? (totals.views / totals.impr) * 100 : 0;
          return (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Mini Icon={BarChart3} label="Impressions" v={totals.impr.toLocaleString()} />
                <Mini Icon={Eye} label="Views" v={totals.views.toLocaleString()} />
                <Mini Icon={Percent} label="CTR" v={`${ctr.toFixed(2)}%`} />
              </div>
              <Card className="p-3">
                <div className="text-xs font-semibold mb-2 flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" />Daily impressions</div>
                {records.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-6">No traffic yet.</div>
                ) : (
                  <div className="flex items-end gap-0.5 h-32">
                    {records.map((r) => {
                      const v = Number(r.LISTING_IMPRESSION_TOTAL || 0);
                      const h = (v / max) * 100;
                      return (
                        <div key={r.day} className="flex-1 flex flex-col items-center gap-0.5 group">
                          <div
                            className="w-full bg-gradient-to-t from-primary to-violet-500 rounded-sm min-h-[2px] transition-all hover:opacity-80"
                            style={{ height: `${h}%` }}
                            title={`${r.day}: ${v} impressions`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-1 text-[10px] text-muted-foreground flex justify-between">
                  <span>{records[0]?.day || ""}</span>
                  <span>{records[records.length - 1]?.day || ""}</span>
                </div>
              </Card>
            </>
          );
        }}
      </AccountScopedPanel>
    </AppShell>
  );
}

function Mini({ Icon, label, v }: { Icon: any; label: string; v: any }) {
  return (
    <Card className="p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="text-lg font-bold tabular-nums">{v}</div>
    </Card>
  );
}
