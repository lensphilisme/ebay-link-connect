import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ExternalLink, Plus, Trash2, Link as LinkIcon } from "lucide-react";
import {
  listEbayAccounts,
  createEbayAccount,
  updateEbayAccount,
  deleteEbayAccount,
} from "@/lib/accounts.functions";
import { getEbayConnectUrl } from "@/lib/ebay.functions";

export function AccountsSettings() {
  const qc = useQueryClient();
  const listFn = useServerFn(listEbayAccounts);
  const createFn = useServerFn(createEbayAccount);
  const updateFn = useServerFn(updateEbayAccount);
  const deleteFn = useServerFn(deleteEbayAccount);
  const urlFn = useServerFn(getEbayConnectUrl);

  const { data: accounts = [] } = useQuery({
    queryKey: ["ebay-accounts"],
    queryFn: () => listFn(),
  });

  // Connect a NEW account: create a placeholder row, then jump to eBay OAuth
  // with the row's id in `state`. The callback renames it from the eBay
  // username automatically, so users never have to type a nickname.
  const connectNew = useMutation({
    mutationFn: async () => {
      const created: any = await createFn({ data: { account_name: "Pending eBay account", region: "US" } });
      const url: string = await urlFn({ data: { accountId: created.id, forceLogin: true } });
      return url;
    },
    onSuccess: (url: string) => { window.location.assign(url); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Reconnect an existing account (also forces a fresh eBay login).
  const reconnect = useMutation({
    mutationFn: (accountId: string) => urlFn({ data: { accountId, forceLogin: true } }),
    onSuccess: (url: string) => { window.location.assign(url); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: ({ id, account_name }: { id: string; account_name: string }) =>
      updateFn({ data: { id, account_name } }),
    onSuccess: () => { toast.success("Renamed"); qc.invalidateQueries({ queryKey: ["ebay-accounts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updateFn({ data: { id, is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ebay-accounts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Account removed"); qc.invalidateQueries({ queryKey: ["ebay-accounts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Each connected eBay seller shows up here. Names are pulled from eBay
        automatically — one click launches a fresh eBay sign-in so you can
        connect a second (or third) account cleanly.
      </p>

      <div className="space-y-2">
        {accounts.length === 0 && (
          <div className="text-sm text-muted-foreground border rounded-lg p-4 text-center">
            No accounts yet. Click below to connect your first eBay seller.
          </div>
        )}
        {accounts.map((a: any) => (
          <AccountRow
            key={a.id}
            account={a}
            onRename={(name) => rename.mutate({ id: a.id, account_name: name })}
            onToggle={(v) => toggleActive.mutate({ id: a.id, is_active: v })}
            onReconnect={() => reconnect.mutate(a.id)}
            onDelete={() => {
              if (confirm(`Remove "${a.account_name}"? Existing listings stay in your database but lose the account link.`))
                remove.mutate(a.id);
            }}
            connecting={reconnect.isPending}
          />
        ))}
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => connectNew.mutate()}
        disabled={connectNew.isPending}
      >
        <Plus className="h-4 w-4 mr-2" />
        {connectNew.isPending ? "Opening eBay…" : "Connect another eBay account"}
        <ExternalLink className="h-3 w-3 ml-2" />
      </Button>
    </div>
  );
}

function AccountRow({
  account, onRename, onToggle, onReconnect, onDelete, connecting,
}: {
  account: any;
  onRename: (name: string) => void;
  onToggle: (v: boolean) => void;
  onReconnect: () => void;
  onDelete: () => void;
  connecting: boolean;
}) {
  const [name, setName] = useState(account.account_name);
  const dirty = name.trim() && name.trim() !== account.account_name;
  return (
    <div className="rounded-lg border p-3 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        {dirty && (
          <Button size="sm" variant="secondary" onClick={() => onRename(name.trim())}>Save</Button>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className={
          account.connected
            ? "rounded-full bg-success/10 text-success text-xs px-2 py-0.5 font-medium"
            : "rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5 font-medium"
        }>
          {account.connected ? (account.ebay_user_id || "Connected") : "Not connected"}
        </span>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Active</Label>
          <Switch checked={account.is_active} onCheckedChange={onToggle} />
        </div>
        <Button size="sm" variant="outline" onClick={onReconnect} disabled={connecting}>
          <LinkIcon className="h-3.5 w-3.5 mr-1" />
          {account.connected ? "Reconnect" : "Connect"}
          <ExternalLink className="h-3 w-3 ml-1" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
