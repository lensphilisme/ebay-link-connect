import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
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

  const [newName, setNewName] = useState("");
  const [newRegion, setNewRegion] = useState("US");
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: () => createFn({ data: { account_name: newName.trim(), region: newRegion.trim() || "US" } }),
    onSuccess: (row: any) => {
      toast.success(`Account "${row.account_name}" created — connect it next`);
      setNewName(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["ebay-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connect = useMutation({
    mutationFn: (accountId: string) => urlFn({ data: { accountId } }),
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
        Manage multiple eBay seller accounts under one login. Each account holds its own
        tokens and can be filtered independently on the dashboard.
      </p>

      <div className="space-y-2">
        {accounts.length === 0 && (
          <div className="text-sm text-muted-foreground border rounded-lg p-4 text-center">
            No accounts yet. Add one below to get started.
          </div>
        )}
        {accounts.map((a: any) => (
          <AccountRow
            key={a.id}
            account={a}
            onRename={(name) => rename.mutate({ id: a.id, account_name: name })}
            onToggle={(v) => toggleActive.mutate({ id: a.id, is_active: v })}
            onConnect={() => connect.mutate(a.id)}
            onDelete={() => {
              if (confirm(`Delete account "${a.account_name}"? Its listings will keep working but lose the account link.`))
                remove.mutate(a.id);
            }}
            connecting={connect.isPending}
          />
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full">
            <Plus className="h-4 w-4 mr-2" /> Add another eBay account
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Add eBay account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Account nickname</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. US Electronics" />
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Input value={newRegion} onChange={(e) => setNewRegion(e.target.value)} placeholder="US" maxLength={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!newName.trim() || create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountRow({
  account, onRename, onToggle, onConnect, onDelete, connecting,
}: {
  account: any;
  onRename: (name: string) => void;
  onToggle: (v: boolean) => void;
  onConnect: () => void;
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
          {account.connected ? "Connected" : "Not connected"}
        </span>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Active</Label>
          <Switch checked={account.is_active} onCheckedChange={onToggle} />
        </div>
        <Button size="sm" variant="outline" onClick={onConnect} disabled={connecting}>
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
