import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AccountScopedPanel } from "@/components/account-scoped-panel";
import { useServerFn } from "@tanstack/react-start";
import { listEbayTransactionsFn } from "@/lib/ebay-live.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, TrendingUp, TrendingDown, Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/finances")({ component: FinancesPage });

const TYPE_COLOR: Record<string, string> = {
  SALE: "text-emerald-600 bg-emerald-500/10",
  REFUND: "text-destructive bg-destructive/10",
  NON_SALE_CHARGE: "text-amber-600 bg-amber-500/10",
  PAYOUT: "text-sky-600 bg-sky-500/10",
};

function FinancesPage() {
  const fn = useServerFn(listEbayTransactionsFn);
  return (
    <AppShell title="Finances" subtitle="Sales, fees & payouts">
      <AccountScopedPanel
        queryKey="ebay-finances"
        fetcher={(accountId) => fn({ data: { accountId, limit: 100 } })}
        empty="Pick a connected account to see finances."
      >
        {(data: any) => {
          const t = data.transactions as any[];
          const sales = t.filter((x) => x.type === "SALE").reduce((s, x) => s + x.amount, 0);
          const fees = t.filter((x) => /CHARGE|FEE/i.test(x.type)).reduce((s, x) => s + x.amount, 0);
          const payouts = t.filter((x) => x.type === "PAYOUT").reduce((s, x) => s + x.amount, 0);
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Mini Icon={TrendingUp} label="Sales" v={`$${sales.toFixed(2)}`} tint="emerald" />
                <Mini Icon={TrendingDown} label="Fees" v={`$${fees.toFixed(2)}`} tint="amber" />
                <Mini Icon={Wallet} label="Payouts" v={`$${payouts.toFixed(2)}`} tint="sky" />
                <Mini Icon={DollarSign} label="Net" v={`$${(sales - fees).toFixed(2)}`} tint="violet" />
              </div>
              <Card className="overflow-hidden">
                {t.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground">No transactions.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Memo</TableHead>
                          <TableHead className="w-[80px] text-right">Amount</TableHead>
                          <TableHead className="w-[80px]">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {t.map((x) => (
                          <TableRow key={x.id}>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] ${TYPE_COLOR[x.type] || ""}`}>{String(x.type || "").replace(/_/g, " ").toLowerCase()}</Badge>
                            </TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{x.memo || x.orderId || "—"}</TableCell>
                            <TableCell className={`text-xs font-semibold text-right tabular-nums ${x.type === "SALE" ? "text-emerald-600" : x.type?.includes("CHARGE") ? "text-destructive" : ""}`}>
                              ${x.amount.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(x.date).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            </>
          );
        }}
      </AccountScopedPanel>
    </AppShell>
  );
}

const TINT: Record<string, string> = {
  emerald: "text-emerald-600 bg-emerald-500/5 ring-emerald-500/20",
  amber: "text-amber-600 bg-amber-500/5 ring-amber-500/20",
  sky: "text-sky-600 bg-sky-500/5 ring-sky-500/20",
  violet: "text-violet-600 bg-violet-500/5 ring-violet-500/20",
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
