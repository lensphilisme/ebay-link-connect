import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEbayAccounts } from "@/lib/accounts.functions";
import { analyzeOptimizerLive, applyOptimizerActionLive } from "@/lib/ebay-live.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Play, Sparkles, Loader2, CheckCircle2, XCircle, Wand2, Ban, Eye, ShoppingCart, Clock } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/optimizer")({ component: OptimizerPage });

type Row = Awaited<ReturnType<typeof analyzeOptimizerLive>>[number] & {
  ui: "pending" | "running" | "done" | "skipped" | "error";
  result?: string;
  error?: string;
};

function OptimizerPage() {
  const accountsFn = useServerFn(listEbayAccounts);
  const analyzeFn = useServerFn(analyzeOptimizerLive);
  const applyFn = useServerFn(applyOptimizerActionLive);
  const { data: accounts = [] } = useQuery({ queryKey: ["ebay-accounts"], queryFn: () => accountsFn() });
  const connected = accounts.filter((a: any) => a.connected && a.is_active);
  const [accountId, setAccountId] = useState<string>("");
  useEffect(() => {
    if (!accountId && connected.length) setAccountId(connected[0].id);
  }, [connected, accountId]);

  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });

  const preview = useMutation({
    mutationFn: () => analyzeFn({ data: { accountId } }),
    onSuccess: (plan) => {
      setRows(plan.map((p) => ({ ...p, ui: p.action === "noop" ? "skipped" : "pending" })));
      toast.success(`Scanned ${plan.length} live listings · ${plan.filter((p) => p.action !== "noop").length} need action`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function runNow() {
    if (!accountId) { toast.error("Pick an account first."); return; }
    setRunning(true);
    try {
      const plan = await analyzeFn({ data: { accountId } });
      const initial: Row[] = plan.map((p) => ({ ...p, ui: p.action === "noop" ? "skipped" : "pending" }));
      setRows(initial);
      const actionable = initial.filter((r) => r.ui === "pending");
      setProgress({ done: 0, total: actionable.length, current: "" });
      for (let i = 0; i < actionable.length; i++) {
        const row = actionable[i];
        setProgress({ done: i, total: actionable.length, current: row.title });
        setRows((prev) => prev.map((r) => r.itemId === row.itemId ? { ...r, ui: "running" } : r));
        try {
          const res: any = await applyFn({ data: { accountId, itemId: row.itemId, action: row.action as any, useAi: row.needs_ai, currentTitle: row.title } });
          setRows((prev) => prev.map((r) => r.itemId === row.itemId ? { ...r, ui: "done", result: res?.newTitle || res?.action || "applied" } : r));
        } catch (e) {
          setRows((prev) => prev.map((r) => r.itemId === row.itemId ? { ...r, ui: "error", error: e instanceof Error ? e.message : String(e) } : r));
        }
      }
      setProgress({ done: actionable.length, total: actionable.length, current: "" });
      toast.success(`Optimizer complete · ${actionable.length} action(s)`);
    } finally { setRunning(false); }
  }

  const totals = rows.reduce((acc, r) => {
    acc.listings++;
    acc.watchers += r.watchers;
    acc.sold += r.quantitySold;
    if (r.action !== "noop") acc.flagged++;
    return acc;
  }, { listings: 0, watchers: 0, sold: 0, flagged: 0 });

  return (
    <AppShell title="Optimizer" subtitle="Live scan · rules first, AI only where it helps">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="h-9 w-full sm:w-[220px]"><SelectValue placeholder="Pick account" /></SelectTrigger>
          <SelectContent>
            {connected.length === 0 && <SelectItem value="_none" disabled>No connected accounts</SelectItem>}
            {connected.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => preview.mutate()} disabled={!accountId || preview.isPending || running}>
          {preview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}Preview
        </Button>
        <Button size="sm" onClick={runNow} disabled={!accountId || running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}Run now
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        <MiniCard Icon={LineChart} label="Live" v={totals.listings} />
        <MiniCard Icon={Eye} label="Watchers" v={totals.watchers} />
        <MiniCard Icon={ShoppingCart} label="Sold" v={totals.sold} />
        <MiniCard Icon={Wand2} label="Flagged" v={totals.flagged} accent />
      </div>

      {(running || progress.total > 0) && (
        <Card className="p-3 mb-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium">{running ? "Running…" : "Complete"}</span>
            <span className="text-muted-foreground tabular-nums">{progress.done}/{progress.total}</span>
          </div>
          <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} className="h-1.5" />
          <div className="mt-1 text-[10px] text-muted-foreground truncate">{progress.current || "Idle"}</div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            <LineChart className="h-6 w-6 mx-auto mb-2 opacity-60" />
            Pick an account, then Preview or Run.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead>
                  <TableHead className="w-[110px]">Action</TableHead>
                  <TableHead className="w-[130px]">Signals</TableHead>
                  <TableHead className="w-[130px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="max-w-[240px] sm:max-w-md">
                      <div className="line-clamp-2 text-xs">{r.title}</div>
                      <div className="text-[10px] text-muted-foreground">${r.price.toFixed(2)} · {r.itemId}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.action === "end" ? "destructive" : r.action === "noop" ? "outline" : "secondary"} className="gap-1 text-[10px]">
                        {r.action === "end" ? <Ban className="h-3 w-3" /> : r.action === "rewrite_title" ? <Wand2 className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                        {r.action}
                        {r.needs_ai && <Sparkles className="h-3 w-3" />}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{r.reason}</div>
                    </TableCell>
                    <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{r.ageDays}d</div>
                      <div className="flex items-center gap-1"><Eye className="h-3 w-3" />{r.watchers}</div>
                      <div className="flex items-center gap-1"><ShoppingCart className="h-3 w-3" />{r.quantitySold}</div>
                    </TableCell>
                    <TableCell>
                      {r.ui === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
                      {r.ui === "done" && (
                        <div className="flex items-start gap-1 text-[11px] text-primary">
                          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                          <span className="line-clamp-2">{r.result}</span>
                        </div>
                      )}
                      {r.ui === "error" && (
                        <div className="flex items-start gap-1 text-[11px] text-destructive">
                          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span className="line-clamp-2">{r.error}</span>
                        </div>
                      )}
                      {r.ui === "skipped" && <span className="text-[10px] text-muted-foreground">skip</span>}
                      {r.ui === "pending" && <span className="text-[10px] text-muted-foreground">pending</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}

function MiniCard({ Icon, label, v, accent }: { Icon: any; label: string; v: number; accent?: boolean }) {
  return (
    <Card className={`p-2.5 ${accent ? "bg-amber-500/10 border-amber-500/30" : ""}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="text-lg font-bold tabular-nums">{v}</div>
    </Card>
  );
}
