import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { analyzeOptimizer, applyOptimizerAction } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Play, Sparkles, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/optimizer")({ component: OptimizerPage });

type AnalyzeRow = Awaited<ReturnType<typeof analyzeOptimizer>>[number];
type ResultRow = AnalyzeRow & { status: "pending" | "running" | "done" | "skipped" | "error"; result?: string; error?: string };

function OptimizerPage() {
  const analyzeFn = useServerFn(analyzeOptimizer);
  const applyFn = useServerFn(applyOptimizerAction);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });

  const { data: listings = [], refetch } = useQuery({
    queryKey: ["ebay-listings-optimizer"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ebay_listings").select("*").order("listed_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const preview = useMutation({
    mutationFn: () => analyzeFn({ data: {} }),
    onSuccess: (plan: AnalyzeRow[]) => {
      setRows(plan.map((p) => ({ ...p, status: p.action === "noop" ? "skipped" : "pending" })));
      const actionable = plan.filter((p) => p.action !== "noop").length;
      toast.success(`Analyzed ${plan.length} listings · ${actionable} need action`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function runNow() {
    setRunning(true);
    try {
      // Phase 1 — deterministic scan, no AI.
      const plan: AnalyzeRow[] = await analyzeFn({ data: {} });
      const initial: ResultRow[] = plan.map((p) => ({ ...p, status: p.action === "noop" ? "skipped" : "pending" }));
      setRows(initial);
      const actionable = initial.filter((r) => r.status === "pending");
      setProgress({ done: 0, total: actionable.length, current: "" });
      // Phase 2 — apply one at a time. AI only when analyze flagged needs_ai.
      for (let i = 0; i < actionable.length; i++) {
        const row = actionable[i];
        setProgress({ done: i, total: actionable.length, current: row.title });
        setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: "running" } : r));
        try {
          const res: any = await applyFn({ data: { id: row.id, action: row.action as any, useAi: row.needs_ai } });
          setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: "done", result: res?.newTitle || res?.action || "applied" } : r));
        } catch (e) {
          setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: "error", error: e instanceof Error ? e.message : String(e) } : r));
        }
      }
      setProgress({ done: actionable.length, total: actionable.length, current: "" });
      toast.success(`Optimizer complete · ${actionable.length} action(s) processed`);
      refetch();
    } finally {
      setRunning(false);
    }
  }

  const aiPending = rows.filter((r) => r.needs_ai && r.status === "pending").length;

  return (
    <AppShell title="Optimizer" subtitle="Two-phase engine · rule-based scan first, AI only where it helps">
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Active listings</div>
          <div className="text-2xl font-semibold">{listings.filter((l: any) => l.status === "active").length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Flagged for action</div>
          <div className="text-2xl font-semibold">{rows.filter((r) => r.status !== "skipped").length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total sales</div>
          <div className="text-2xl font-semibold">{listings.reduce((s: number, l: any) => s + (l.sales || 0), 0)}</div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending || running}>
          {preview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Preview plan
        </Button>
        <Button onClick={runNow} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          Run now
        </Button>
      </div>

      {(running || progress.total > 0) && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">{running ? "Running optimizer…" : "Last run complete"}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{progress.done} / {progress.total}</span>
          </div>
          <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          <div className="mt-2 text-xs text-muted-foreground truncate">
            {running && progress.current ? `Processing: ${progress.current}` : aiPending > 0 ? `${aiPending} AI rewrite(s) queued in the plan` : "Idle"}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <LineChart className="h-8 w-8 mx-auto mb-2 opacity-60" />
            No plan yet. Click <strong>Preview plan</strong> to run the rule engine (no AI), or <strong>Run now</strong> to execute end-of-life and rewrites.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Listing</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Signals</TableHead>
                <TableHead className="w-32">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-md line-clamp-2">{r.title}</TableCell>
                  <TableCell>
                    <Badge variant={r.action === "end" ? "destructive" : r.action === "noop" ? "outline" : "secondary"}>
                      {r.action}{r.needs_ai ? " · AI" : ""}
                    </Badge>
                    <div className="text-[11px] text-muted-foreground mt-1">{r.reason}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {r.age_days}d · v{r.views} · c{r.clicks} · s{r.sales}
                  </TableCell>
                  <TableCell>
                    {r.status === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {r.status === "done" && (
                      <div className="flex items-start gap-1 text-xs text-primary">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5" />
                        <span className="line-clamp-2 break-words">{r.result}</span>
                      </div>
                    )}
                    {r.status === "error" && (
                      <div className="flex items-start gap-1 text-xs text-destructive">
                        <XCircle className="h-3.5 w-3.5 mt-0.5" />
                        <span className="line-clamp-2 break-words">{r.error}</span>
                      </div>
                    )}
                    {r.status === "skipped" && <span className="text-xs text-muted-foreground">skip</span>}
                    {r.status === "pending" && <span className="text-xs text-muted-foreground">pending</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </AppShell>
  );
}
