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
  TrendingUp,
  ArrowLeftRight,
  Coins,
  FileText,
  Upload,
  Calendar,
  ClipboardCheck,
  History,
  UserCog,
  CreditCard,
  Package,
  Landmark,
  BarChart3,
  ListChecks,
  ShieldCheck,
  Database,
  HardDrive,
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { ROUTE_PERMISSIONS } from "@/lib/rbac-service";

interface CommandRoute {
  title: string;
  url: string;
  icon: React.ElementType;
  group: string;
  roles?: AppRole[];
}

const routes: CommandRoute[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, group: "Overview" },
  { title: "Companies", url: "/companies", icon: Building2, group: "Master Data" },
  { title: "Clients", url: "/clients", icon: Users, group: "Master Data" },
  { title: "Debenture Interest", url: "/interest", icon: Wallet, group: "Payables" },
  { title: "Stock Dividend", url: "/dividend", icon: TrendingUp, group: "Payables" },
  { title: "Mutual Fund", url: "/mutual-fund", icon: Coins, group: "Payables" },
  { title: "Payments", url: "/payments", icon: CreditCard, group: "Operations" },
  {
    title: "Bank Reconciliation",
    url: "/reconciliation",
    icon: ArrowLeftRight,
    group: "Operations",
  },
  {
    title: "CDSC & IAF Allotments",
    url: "/allocations",
    icon: Package,
    group: "Operations",
    roles: ["admin", "supervisor", "finance_operator", "operator", "maker"],
  },
  { title: "AGM Historical Studio", url: "/agm-studio", icon: Landmark, group: "Operations" },
  {
    title: "Pending Approvals",
    url: "/approvals",
    icon: ClipboardCheck,
    group: "Operations",
    roles: ["admin", "supervisor", "approver", "checker", "auditor"],
  },
  { title: "Upload Data", url: "/upload", icon: Upload, group: "Operations" },
  { title: "Upload History", url: "/upload-history", icon: History, group: "Operations" },
  { title: "Reports", url: "/reports", icon: FileText, group: "Insights & Operations" },
  { title: "Analytics", url: "/analytics", icon: BarChart3, group: "Insights & Operations" },
  {
    title: "Classification Review",
    url: "/classification-review",
    icon: ListChecks,
    group: "Insights & Operations",
    roles: ["admin", "supervisor", "checker", "approver", "operator", "auditor"],
  },
  {
    title: "Audit Log",
    url: "/audit-logs",
    icon: ShieldCheck,
    group: "Insights & Operations",
    roles: ["admin", "auditor", "supervisor"],
  },
  {
    title: "Data Management",
    url: "/data-management",
    icon: Database,
    group: "Insights & Operations",
    roles: ["admin"],
  },
  {
    title: "Users & Roles",
    url: "/users",
    icon: UserCog,
    group: "Administration",
    roles: ["admin"],
  },
  {
    title: "Fiscal Years",
    url: "/settings/fiscal-years",
    icon: Calendar,
    group: "Administration",
    roles: ["admin"],
  },
  {
    title: "Backup & Recovery",
    url: "/backup",
    icon: HardDrive,
    group: "Administration",
    roles: ["admin"],
  },
  {
    title: "System Settings",
    url: "/settings",
    icon: Settings,
    group: "Administration",
    roles: ["admin"],
  },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { roles } = useAuth();

  const go = (url: string) => {
    onOpenChange(false);
    navigate({ to: url });
  };

  const canSee = (requiredRoles?: AppRole[]) => {
    if (!requiredRoles || requiredRoles.length === 0) return true;
    if (roles.includes("admin")) return true;
    return requiredRoles.some((r) => roles.includes(r));
  };

  const visibleRoutes = routes.filter((r) => canSee(r.roles ?? ROUTE_PERMISSIONS[r.url]));
  const groups = Array.from(new Set(visibleRoutes.map((r) => r.group)));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search modules, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g} heading={g}>
            {visibleRoutes
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
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
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
