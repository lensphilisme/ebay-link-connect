import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  listAccountRules,
  upsertAccountRule,
  deleteAccountRule,
  listEbayAccounts,
} from "@/lib/accounts.functions";

export function AccountRulesSettings() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAccountRules);
  const upsertFn = useServerFn(upsertAccountRule);
  const deleteFn = useServerFn(deleteAccountRule);
  const accountsFn = useServerFn(listEbayAccounts);

  const { data: rules = [] } = useQuery({ queryKey: ["account-rules"], queryFn: () => listFn() });
  const { data: accounts = [] } = useQuery({ queryKey: ["ebay-accounts"], queryFn: () => accountsFn() });

  const [accountId, setAccountId] = useState<string>("");
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");

  const add = useMutation({
    mutationFn: () => upsertFn({ data: {
      account_id: accountId,
      cj_category: category.trim(),
      region: region.trim() || undefined,
    } }),
    onSuccess: () => {
      toast.success("Rule added");
      setCategory(""); setRegion("");
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Map CJ Dropshipping categories to eBay accounts. When you push a product,
        the app prefers the account that owns its category. Overlaps are allowed
        but flagged with a warning.
      </p>

      {accounts.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-lg p-4">
          Add an eBay account in the section above first.
        </div>
      ) : (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-4">
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
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">CJ category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electronics" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Region</Label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="US" maxLength={4} />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full sm:w-auto"
            disabled={!accountId || !category.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            <Plus className="h-4 w-4 mr-1" /> Add rule
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
