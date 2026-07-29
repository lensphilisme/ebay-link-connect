import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AccountScopedPanel } from "@/components/account-scoped-panel";
import { useServerFn } from "@tanstack/react-start";
import { getEbaySalesSummaryFn } from "@/lib/ebay-live.functions";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, ShoppingCart, Package } from "lucide-react";

export const Route = createFileRoute("/_authenticated/finances")({
  component: FinancesPage,
  head: () => ({
    meta: [
      { title: "Money — eBay sales totals" },
      { name: "description", content: "Live eBay sales totals for each connected seller account, matching the Orders feed." },
      { property: "og:title", content: "Money — eBay sales totals" },
      { property: "og:description", content: "Live eBay sales totals for each connected seller account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function FinancesPage() {
  const fn = useServerFn(getEbaySalesSummaryFn);
  return (
    <AppShell title="Money" subtitle="Sales from your live eBay orders">
      <AccountScopedPanel
        queryKey="ebay-sales"
        fetcher={(accountId) => fn({ data: { accountId } })}
        empty="Pick a connected account to see sales."
      >
        {(data: any) => {
          const orders: any[] = data.orders || [];
          return (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Mini Icon={TrendingUp} label="Sales" v={`$${Number(data.sales || 0).toFixed(2)}`} tint="emerald" />
                <Mini Icon={ShoppingCart} label="Orders" v={data.ordersCount ?? 0} tint="violet" />
                <Mini Icon={Package} label="Items" v={data.units ?? 0} tint="sky" />
              </div>
              <Card className="overflow-hidden">
                {orders.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground">No sales in this window.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="w-[80px] text-right">Amount</TableHead>
                          <TableHead className="w-[80px]">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orders.map((o) => (
                          <TableRow key={o.orderId}>
                            <TableCell className="text-xs max-w-[220px] truncate">{o.firstItemTitle || o.orderId}</TableCell>
                            <TableCell className="text-xs font-semibold text-right tabular-nums text-emerald-600">
                              ${Number(o.total || 0).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {new Date(o.creationDate).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
              <p className="text-[10px] text-muted-foreground px-1">
                Only gross sales are shown — eBay fees and payouts are excluded because the fee feed is unreliable.
              </p>
            </>
          );
        }}
      </AccountScopedPanel>
    </AppShell>
  );
}

const TINT: Record<string, string> = {
  emerald: "text-emerald-600 bg-emerald-500/5 ring-emerald-500/20",
  violet: "text-violet-600 bg-violet-500/5 ring-violet-500/20",
  sky: "text-sky-600 bg-sky-500/5 ring-sky-500/20",
};

function Mini({ Icon, label, v, tint }: { Icon: any; label: string; v: any; tint: string }) {
  return (
    <Card className={`p-2.5 border-0 ring-1 ${TINT[tint]}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="text-lg font-bold tabular-nums">{v}</div>
    </Card>
  );
}
