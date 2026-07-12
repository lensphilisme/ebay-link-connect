import { useEffect, useState, useSyncExternalStore } from "react";

const KEY = "active_ebay_account_id";
const EVENT = "active-ebay-account-changed";

export function getActiveAccountId(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}

export function setActiveAccountId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useActiveAccountId(): [string | null, (id: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => getActiveAccountId(),
    () => null,
  );
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  return [hydrated ? value : null, setActiveAccountId];
}
