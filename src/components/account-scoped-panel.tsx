import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEbayAccounts } from "@/lib/accounts.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Loader2, AlertCircle } from "lucide-react";

export function AccountScopedPanel<T>({ queryKey, fetcher, empty, children }: {
  queryKey: string;
  fetcher: (accountId: string) => Promise<T>;
  empty: ReactNode;
  children: (data: T, accountId: string) => ReactNode;
}) {
  const accountsFn = useServerFn(listEbayAccounts);
  const { data: accounts = [] } = useQuery({ queryKey: ["ebay-accounts"], queryFn: () => accountsFn() });
  const connected = accounts.filter((a: any) => a.connected && a.is_active);
  const [accountId, setAccountId] = useState<string>("");
  useEffect(() => { if (!accountId && connected.length) setAccountId(connected[0].id); }, [connected, accountId]);
  const { data, isLoading, error } = useQuery({
    queryKey: [queryKey, accountId],
    queryFn: () => fetcher(accountId),
    enabled: !!accountId,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-3">
      <Select value={accountId} onValueChange={setAccountId}>
        <SelectTrigger className="h-9 w-full sm:w-[240px]"><SelectValue placeholder="Pick account" /></SelectTrigger>
        <SelectContent>
          {connected.length === 0 && <SelectItem value="_" disabled>No connected accounts</SelectItem>}
          {connected.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>)}
        </SelectContent>
      </Select>
      {!accountId && <Card className="p-6 text-center text-xs text-muted-foreground">{empty}</Card>}
      {accountId && isLoading && (
        <Card className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading from eBay…
        </Card>
      )}
      {accountId && error && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="min-w-0"><div className="font-semibold">eBay API error</div><div className="break-words">{(error as Error).message}</div></div>
          </div>
        </Card>
      )}
      {accountId && data !== undefined && !isLoading && !error && children(data as T, accountId)}
    </div>
  );
}
