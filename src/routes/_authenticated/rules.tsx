import { createFileRoute, redirect } from "@tanstack/react-router";

// Rules were moved into Settings. Redirect any old links.
export const Route = createFileRoute("/_authenticated/rules")({
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  },
});
