import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, ChevronDown, Search } from "lucide-react";
import { toast } from "sonner";
import {
  listAccountRules,
  upsertAccountRule,
  deleteAccountRule,
  listEbayAccounts,
} from "@/lib/accounts.functions";
import { getCjCategories } from "@/lib/cj.functions";

type Leaf = { path: string; categoryName: string };

export function AccountRulesSettings() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAccountRules);
  const upsertFn = useServerFn(upsertAccountRule);
  const deleteFn = useServerFn(deleteAccountRule);
  const accountsFn = useServerFn(listEbayAccounts);
  const cjCatsFn = useServerFn(getCjCategories);

  const { data: rules = [] } = useQuery({ queryKey: ["account-rules"], queryFn: () => listFn() });
  const { data: accounts = [] } = useQuery({ queryKey: ["ebay-accounts"], queryFn: () => accountsFn() });
  const { data: cjTree = [], isLoading: cjLoading } = useQuery({
    queryKey: ["cj-categories"],
    queryFn: () => cjCatsFn(),
    staleTime: 15 * 60 * 1000,
  });

  const leaves = useMemo<Leaf[]>(() => {
    const out: Leaf[] = [];
    for (const l1 of cjTree as any[]) {
      for (const l2 of l1.categoryFirstList || []) {
        for (const l3 of l2.categorySecondList || []) {
          out.push({
            path: `${l1.categoryFirstName} / ${l2.categorySecondName} / ${l3.categoryName}`,
            categoryName: l3.categoryName,
          });
        }
        // Also expose the L2 itself as a coarser bucket
        out.push({
          path: `${l1.categoryFirstName} / ${l2.categorySecondName}`,
          categoryName: l2.categorySecondName,
        });
      }
    }
    return out;
  }, [cjTree]);

  const [accountId, setAccountId] = useState<string>("");
  const [region, setRegion] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return leaves.slice(0, 200);
    return leaves.filter((l) => l.path.toLowerCase().includes(term)).slice(0, 200);
  }, [leaves, q]);

  const add = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error("Pick an account first");
      if (picked.size === 0) throw new Error("Pick at least one CJ category");
      for (const cat of picked) {
        await upsertFn({ data: {
          account_id: accountId,
          cj_category: cat,
          region: region.trim() || undefined,
        }});
      }
      return picked.size;
    },
    onSuccess: (n) => {
      toast.success(`${n} rule${n === 1 ? "" : "s"} added`);
      setPicked(new Set()); setRegion("");
      qc.invalidateQueries({ queryKey: ["account-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Rule removed"); qc.invalidateQueries({ queryKey: ["account-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Detect overlaps (same cj_category on multiple accounts) — warn, do not block.
  const overlaps = new Set<string>();
  const seen = new Map<string, string>();
  for (const r of rules as any[]) {
    const key = `${(r.cj_category || "").toLowerCase()}::${(r.region || "").toLowerCase()}`;
    if (seen.has(key) && seen.get(key) !== r.account_id) overlaps.add(key);
    seen.set(key, r.account_id);
  }

  const accountName = (id: string) =>
    (accounts as any[]).find((a) => a.id === id)?.account_name || "—";

  const toggle = (path: string) => {
    const next = new Set(picked);
    if (next.has(path)) next.delete(path); else next.add(path);
    setPicked(next);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Map CJ Dropshipping categories to eBay accounts. When you push a product,
        it's routed to the account owning its category. Overlaps are allowed
        but flagged with a warning.
      </p>

      {accounts.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-lg p-4">
          Connect an eBay account in the section above first.
        </div>
      ) : (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Pick account" /></SelectTrigger>
                <SelectContent>
                  {(accounts as any[]).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-1">
              <Label className="text-xs">Region (optional)</Label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="US" maxLength={4} />
            </div>
            <div className="space-y-1 sm:col-span-1">
              <Label className="text-xs">CJ categories</Label>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between h-9">
                    <span className="truncate">
                      {picked.size === 0 ? (cjLoading ? "Loading…" : "Pick categories") : `${picked.size} selected`}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(92vw,420px)] p-0" align="start">
                  <div className="p-2 border-b flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search CJ categories"
                      className="h-8 border-0 focus-visible:ring-0 px-0"
                    />
                  </div>
                  <div className="max-h-72 overflow-auto p-1">
                    {filtered.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground text-center">
                        {cjLoading ? "Loading CJ tree…" : "No matches"}
                      </div>
                    ) : filtered.map((l) => (
                      <label
                        key={l.path}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-sm"
                      >
                        <Checkbox
                          checked={picked.has(l.path)}
                          onCheckedChange={() => toggle(l.path)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium truncate">{l.categoryName}</span>
                          <span className="block text-xs text-muted-foreground truncate">{l.path}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="border-t p-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{picked.size} selected</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                      <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <Button
            size="sm"
            className="w-full sm:w-auto"
            disabled={!accountId || picked.size === 0 || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? "Saving…" : `Link ${picked.size || ""} categor${picked.size === 1 ? "y" : "ies"}`.trim()}
          </Button>
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No rules yet.</p>
      ) : (
        <div className="space-y-1">
          {(rules as any[]).map((r) => {
            const key = `${(r.cj_category || "").toLowerCase()}::${(r.region || "").toLowerCase()}`;
            const isOverlap = overlaps.has(key);
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.cj_category}</div>
                  <div className="text-xs text-muted-foreground">
                    → {accountName(r.account_id)}
                    {r.region ? ` · ${r.region}` : ""}
                  </div>
                </div>
                {isOverlap && (
                  <span className="rounded-full bg-yellow-500/10 text-yellow-600 text-[10px] px-2 py-0.5 font-medium">
                    overlap
                  </span>
                )}
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)} aria-label="Delete">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
