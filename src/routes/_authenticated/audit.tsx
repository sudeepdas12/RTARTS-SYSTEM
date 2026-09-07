import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/audit")({
  beforeLoad: () => {
    throw redirect({ to: "/audit-logs" });
  },
  component: () => null,
});
