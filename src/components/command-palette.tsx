import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useTheme } from "@/hooks/use-theme";
import {
  LayoutDashboard,
  Building2,
  Users,
  Wallet,
  LineChart,
  ArrowLeftRight,
  Coins,
  FileText,
  Upload,
  Calendar,
  ClipboardCheck,
  History,
  UserCog,
  Sun,
  Moon,
} from "lucide-react";

const routes = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, group: "Overview" },
  { title: "Companies", url: "/companies", icon: Building2, group: "Master Data" },
  { title: "Clients", url: "/clients", icon: Users, group: "Master Data" },
  { title: "Debenture Interest", url: "/interest", icon: Wallet, group: "Payables" },
  { title: "Stock Dividend", url: "/dividend", icon: LineChart, group: "Payables" },
  { title: "Mutual Fund", url: "/mutual-fund", icon: Coins, group: "Payables" },
  { title: "Bank Reconciliation", url: "/reconciliation", icon: ArrowLeftRight, group: "Operations" },
  { title: "IAF Allocations", url: "/allocations", icon: Coins, group: "Operations" },
  { title: "Pending Approvals", url: "/approvals", icon: ClipboardCheck, group: "Operations" },
  { title: "Uploads", url: "/uploads", icon: Upload, group: "Operations" },
  { title: "Reports", url: "/reports", icon: FileText, group: "Insights" },
  { title: "Audit Log", url: "/audit", icon: History, group: "Insights" },
  { title: "Users & Roles", url: "/users", icon: UserCog, group: "Administration" },
  { title: "Fiscal Years", url: "/settings/fiscal-years", icon: Calendar, group: "Administration" },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const go = (url: string) => {
    onOpenChange(false);
    navigate({ to: url });
  };

  const groups = Array.from(new Set(routes.map((r) => r.group)));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search modules, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g} heading={g}>
            {routes
              .filter((r) => r.group === g)
              .map((r) => (
                <CommandItem key={r.url} onSelect={() => go(r.url)} value={`${r.title} ${r.url}`}>
                  <r.icon className="mr-2 h-4 w-4" />
                  {r.title}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem
            onSelect={() => {
              setTheme(theme === "dark" ? "light" : "dark");
              onOpenChange(false);
            }}
          >
            {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            Toggle {theme === "dark" ? "light" : "dark"} mode
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}
