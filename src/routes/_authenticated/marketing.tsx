import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AccountScopedPanel } from "@/components/account-scoped-panel";
import { useServerFn } from "@tanstack/react-start";
import { listEbayCampaignsFn } from "@/lib/ebay-live.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Megaphone, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/marketing")({ component: MarketingPage });

function MarketingPage() {
  const fn = useServerFn(listEbayCampaignsFn);
  return (
    <AppShell title="Marketing" subtitle="Promoted Listings campaigns">
      <AccountScopedPanel
        queryKey="ebay-campaigns"
        fetcher={(accountId) => fn({ data: { accountId } })}
        empty="Pick a connected account to see campaigns."
      >
        {(campaigns: any[]) => (
          <Card className="overflow-hidden">
            {campaigns.length === 0 ? (
              <div className="p-10 text-center text-xs text-muted-foreground">
                <Megaphone className="h-6 w-6 mx-auto mb-2 opacity-60" />
                No campaigns yet. Create one from the eBay Seller Hub.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead className="w-[100px]">Strategy</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead className="w-[100px]">Window</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="h-3 w-3 text-primary" />
                            <span className="truncate">{c.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-[10px]">
                          <Badge variant="outline" className="text-[10px]">{c.strategy || "—"}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.status === "ACTIVE" ? "default" : "outline"} className="text-[10px]">
                            {String(c.status || "").toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {c.startDate ? new Date(c.startDate).toLocaleDateString() : "—"}
                          {c.endDate ? ` → ${new Date(c.endDate).toLocaleDateString()}` : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        )}
      </AccountScopedPanel>
    </AppShell>
  );
}
