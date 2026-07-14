import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AccountScopedPanel } from "@/components/account-scoped-panel";
import { useServerFn } from "@tanstack/react-start";
import { listEbayOrdersFn } from "@/lib/ebay-live.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShoppingCart, Package, Clock, User, DollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/orders")({ component: OrdersPage });

function OrdersPage() {
  const fn = useServerFn(listEbayOrdersFn);
  return (
    <AppShell title="Orders" subtitle="Live fulfillment feed">
      <AccountScopedPanel
        queryKey="ebay-orders"
        fetcher={(accountId) => fn({ data: { accountId, limit: 50 } })}
        empty="Pick a connected account to see recent orders."
      >
        {(orders: any[]) => (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Mini Icon={ShoppingCart} label="Orders" v={orders.length} />
              <Mini Icon={DollarSign} label="Total" v={`$${orders.reduce((s, o) => s + o.total, 0).toFixed(0)}`} />
              <Mini Icon={Package} label="Items" v={orders.reduce((s, o) => s + o.itemsCount, 0)} />
            </div>
            <Card className="overflow-hidden">
              {orders.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">No orders in the last window.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="w-[90px]">Buyer</TableHead>
                        <TableHead className="w-[80px]">Total</TableHead>
                        <TableHead className="w-[90px]">Status</TableHead>
                        <TableHead className="w-[80px]">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((o) => (
                        <TableRow key={o.orderId}>
                          <TableCell className="max-w-[220px]">
                            <div className="flex items-center gap-2">
                              {o.firstItemImage && <img src={o.firstItemImage} alt="" className="h-8 w-8 rounded object-cover shrink-0" />}
                              <div className="min-w-0">
                                <div className="text-xs line-clamp-1">{o.firstItemTitle || o.orderId}</div>
                                <div className="text-[10px] text-muted-foreground">{o.itemsCount} item{o.itemsCount === 1 ? "" : "s"}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-[11px] truncate max-w-[90px]"><User className="h-3 w-3 inline mr-1" />{o.buyer}</TableCell>
                          <TableCell className="text-xs font-semibold tabular-nums">${o.total.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={o.status === "FULFILLED" ? "secondary" : o.status === "IN_PROGRESS" ? "default" : "outline"} className="text-[10px]">
                              {String(o.status || "").replace(/_/g, " ").toLowerCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                            <Clock className="h-3 w-3 inline mr-1" />{new Date(o.creationDate).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </>
        )}
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
