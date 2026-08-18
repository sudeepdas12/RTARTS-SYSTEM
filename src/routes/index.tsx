import { createFileRoute, Link } from "@tanstack/react-router";
import { LineChart, ShieldCheck, Wallet, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/40">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <img
            src="/rbb-logo.jpg"
            alt="RBBMBL"
            className="h-24 w-24 rounded-md object-contain"
          />
          <span className="text-lg font-semibold tracking-tight">RBBMBL</span>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/auth" search={{ mode: "signup" } as never}>
              Get started
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <section className="mx-auto max-w-3xl text-center">
          <span className="inline-block rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            Registrar & Transfer Agent Platform
          </span>
          <h1 className="mt-6 text-5xl font-bold tracking-tight md:text-6xl">
            Debenture interest & stock dividend, <span className="text-accent">reconciled.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            A complete platform for RTAs to manage payables, reconcile bank transactions, track
            allocations, and keep an immutable audit trail — with role-based access for finance,
            reconciliation, and audit teams.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Open the console</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#modules">Explore modules</a>
            </Button>
          </div>
        </section>

        <section id="modules" className="mt-24 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Wallet,
              title: "Interest Payables",
              body: "Track debenture interest by company, client, and due date with auto tax calc.",
            },
            {
              icon: LineChart,
              title: "Dividend Payables",
              body: "Manage stock dividends by fiscal year with shares × rate calculation.",
            },
            {
              icon: FileSpreadsheet,
              title: "Bank Reconciliation",
              body: "Upload bank statements, auto-match to payables, or reconcile manually.",
            },
            {
              icon: ShieldCheck,
              title: "Audit & Roles",
              body: "Every write is logged. Admin, finance, reconciliation, and auditor roles.",
            },
          ].map((m) => (
            <div key={m.title} className="rounded-xl border bg-card p-6 shadow-sm">
              <m.icon className="h-8 w-8 text-accent" />
              <h3 className="mt-4 font-semibold">{m.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{m.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t bg-card/50">
        <div className="mx-auto max-w-6xl px-6 py-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} RBBMBL Management System
        </div>
      </footer>
    </div>
  );
}
