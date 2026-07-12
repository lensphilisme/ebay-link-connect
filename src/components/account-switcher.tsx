import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEbayAccounts } from "@/lib/accounts.functions";
import { useActiveAccountId } from "@/lib/active-account";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users } from "lucide-react";

const ALL = "__all__";

export function AccountSwitcher() {
  const listFn = useServerFn(listEbayAccounts);
  const { data: accounts = [] } = useQuery({
    queryKey: ["ebay-accounts"],
    queryFn: () => listFn(),
  });
  const [active, setActive] = useActiveAccountId();

  const value = active ?? ALL;

  if (accounts.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Users className="h-4 w-4 text-muted-foreground shrink-0" />
      <Select
        value={value}
        onValueChange={(v) => setActive(v === ALL ? null : v)}
      >
        <SelectTrigger className="h-9 min-w-[160px]">
          <SelectValue placeholder="All accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All accounts</SelectItem>
          {accounts.map((a: any) => (
            <SelectItem key={a.id} value={a.id}>
              {a.account_name}{!a.connected ? " (not connected)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
