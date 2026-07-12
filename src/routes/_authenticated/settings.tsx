import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { connectEbayWithCode, getEbayConnectUrl } from "@/lib/ebay.functions";
import { saveCjApiKey, getIntegrationStatus } from "@/lib/cj.functions";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { KeyRound, Boxes, Tag, ExternalLink, Type, Globe, Sliders, Sparkles, Users, Route as RouteIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TypographySettings } from "@/components/typography-settings";
import { AppUrlSettings } from "@/components/app-url-settings";
import { RulesSettings } from "@/components/rules-settings";
import { AccountsSettings } from "@/components/accounts-settings";
import { AccountRulesSettings } from "@/components/account-rules-settings";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

function SettingsPage() {
  const [code, setCode] = useState("");
  const [cjEmail, setCjEmail] = useState("");
  const [cjApiKey, setCjApiKey] = useState("");
  const urlFn = useServerFn(getEbayConnectUrl);
  const connectFn = useServerFn(connectEbayWithCode);
  const cjSaveFn = useServerFn(saveCjApiKey);
  const statusFn = useServerFn(getIntegrationStatus);

  const { data: status, refetch } = useQuery({
    queryKey: ["integration-status"],
    queryFn: () => statusFn(),
  });
  const ebayReady = !!status?.ebay.connected;
  const cjReady = !!status?.cj.connected;
  const cjSource = status?.cj.source;

  const openOAuth = useMutation({
    mutationFn: () => urlFn(),
    onSuccess: (url: string) => {
      // Same-tab navigation so the eBay callback lands back in this session
      // and can auto-exchange the code — no manual paste required.
      window.location.assign(url);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const connect = useMutation({
    mutationFn: () => connectFn({ data: { code } }),
    onSuccess: () => { toast.success("eBay connected"); setCode(""); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveCj = useMutation({
    mutationFn: () => cjSaveFn({ data: { email: cjEmail || (status?.cj.email ?? ""), apiKey: cjApiKey } }),
    onSuccess: () => { toast.success("CJ Dropshipping connected — tokens are now managed automatically"); setCjApiKey(""); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Settings" subtitle="Integrations, workspace preferences and rules">
      <Card className="shadow-[var(--shadow-card)] p-2 sm:p-4">
        <Accordion type="multiple" defaultValue={["typography"]} className="w-full">
          <Section value="typography" icon={Type} title="Typography" status="Site-wide font">
            <TypographySettings />
          </Section>

          <Section value="app-url" icon={Globe} title="App URL" status="Live domain">
            <AppUrlSettings />
          </Section>

          <Section
            value="cj"
            icon={Boxes}
            title="CJ Dropshipping"
            status={cjReady ? (cjSource === "env" ? "Connected (workspace key)" : "Connected") : "Not connected"}
            ready={cjReady}
          >
            <div className="space-y-2">
              <Input
                type="email"
                value={cjEmail}
                onChange={(e) => setCjEmail(e.target.value)}
                placeholder={status?.cj.email || "CJ account email"}
              />
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={cjApiKey}
                  onChange={(e) => setCjApiKey(e.target.value)}
                  placeholder="CJ API key"
                />
                <Button onClick={() => saveCj.mutate()} disabled={!cjApiKey || (!cjEmail && !status?.cj.email) || saveCj.isPending}>
                  {saveCj.isPending ? "Connecting…" : "Save"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Get your API key at{" "}
                <a className="text-primary underline inline-flex items-center gap-1" href="https://developers.cjdropshipping.com" target="_blank" rel="noreferrer">
                  developers.cjdropshipping.com <ExternalLink className="h-3 w-3" />
                </a>{" "}— My API → API key. Access &amp; refresh tokens are handled for you.
              </p>
            </div>
          </Section>

          <Section
            value="ebay"
            icon={Tag}
            title="eBay"
            status={ebayReady ? "Connected" : "Needs OAuth"}
            ready={ebayReady}
          >
            <div className="space-y-3">
              <Button onClick={() => openOAuth.mutate()} disabled={openOAuth.isPending}>
                {openOAuth.isPending ? "Opening…" : "Connect your eBay account"}
                <ExternalLink className="h-3 w-3 ml-2" />
              </Button>
              <p className="text-xs text-muted-foreground">
                You'll be redirected to eBay to approve access, then automatically sent
                back and connected — no code to copy.
              </p>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Having trouble? Paste an authorization code manually
                </summary>
                <div className="flex gap-2 mt-2">
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Authorization code" />
                  <Button variant="outline" onClick={() => connect.mutate()} disabled={!code || connect.isPending}>Save</Button>
                </div>
              </details>
              <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs space-y-1">
                <div className="font-medium">Before bulk push you must:</div>
                <ul className="list-disc ml-4 space-y-0.5">
                  <li>Opt in to eBay Business Policies → <a className="text-primary underline" target="_blank" rel="noreferrer" href="https://www.bizpolicy.ebay.com/businesspolicy/manage">bizpolicy.ebay.com</a></li>
                  <li>Create a default payment, shipping and return policy</li>
                  <li>Enable the Live Push switch in the Rules section below</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section value="ai" icon={KeyRound} title="Lovable AI (built-in)" status="Ready" ready>
            <p className="text-sm text-muted-foreground">
              Powers title rewrites, item-specifics guessing and category suggestions.
              No key needed — included with your workspace.
            </p>
          </Section>

          <Section value="rules" icon={Sliders} title="Rules" status="Pricing & optimizer">
            <RulesSettings />
          </Section>
        </Accordion>
      </Card>
    </AppShell>
  );
}

function Section({
  value, icon: Icon, title, status, ready, children,
}: {
  value: string;
  icon: typeof Sparkles;
  title: string;
  status: string;
  ready?: boolean;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="border-b last:border-b-0">
      <AccordionTrigger className="hover:no-underline px-2 py-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4" />
          </div>
          <span className="font-medium text-left truncate">{title}</span>
          <span
            className={
              ready
                ? "ml-auto rounded-full bg-success/10 text-success text-xs px-2 py-0.5 font-medium shrink-0"
                : "ml-auto rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5 font-medium shrink-0"
            }
          >
            {status}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-2 pb-4">{children}</AccordionContent>
    </AccordionItem>
  );
}
