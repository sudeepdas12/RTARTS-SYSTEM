import { Link, useRouterState } from "@tanstack/react-router";
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
  Database,
  Settings,
  CreditCard,
  Package,
  BarChart3,
  ShieldCheck,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth, type AppRole } from "@/hooks/use-auth";

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  /** Roles that can see this item. Undefined = visible to everyone. */
  roles?: AppRole[];
}

interface NavSection {
  label: string;
  items: NavItem[];
  /** Roles that can see the entire section. Undefined = visible to everyone. */
  roles?: AppRole[];
}

const sections: NavSection[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Master Data",
    items: [
      { title: "Companies", url: "/companies", icon: Building2 },
      { title: "Clients", url: "/clients", icon: Users },
    ],
  },
  {
    label: "Payables",
    items: [
      { title: "Debenture Interest", url: "/interest", icon: Wallet },
      { title: "Stock Dividend", url: "/dividend", icon: TrendingUp },
      { title: "Mutual Fund", url: "/mutual-fund", icon: Coins },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Payments", url: "/payments", icon: CreditCard },
      { title: "Bank Reconciliation", url: "/reconciliation", icon: ArrowLeftRight },
      { title: "IAF Allocations", url: "/allocations", icon: Package },
      {
        title: "Pending Approvals",
        url: "/approvals",
        icon: ClipboardCheck,
        roles: ["admin", "supervisor", "approver", "checker"] as AppRole[],
      },
      { title: "Upload Data", url: "/upload", icon: Upload },
      { title: "Upload History", url: "/upload-history", icon: History },
    ],
  },
  {
    label: "Insights & Operations",
    items: [
      { title: "Reports", url: "/reports", icon: FileText },
      { title: "Analytics", url: "/analytics", icon: BarChart3 },
      {
        title: "Data Management",
        url: "/data-management",
        icon: Database,
        roles: ["admin", "supervisor"] as AppRole[],
      },
      {
        title: "Audit Log",
        url: "/audit-logs",
        icon: ShieldCheck,
        roles: ["admin", "auditor", "supervisor"] as AppRole[],
      },
    ],
  },
  {
    label: "Administration",
    roles: ["admin"] as AppRole[],
    items: [
      { title: "Users & Roles", url: "/users", icon: UserCog },
      { title: "Fiscal Years", url: "/settings/fiscal-years", icon: Calendar },
      { title: "System Settings", url: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { roles } = useAuth();

  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");

  /** Returns true if the user has at least one of the required roles (admin always passes). */
  const canSee = (requiredRoles?: AppRole[]) => {
    if (!requiredRoles || requiredRoles.length === 0) return true;
    if (roles.includes("admin")) return true;
    return requiredRoles.some((r) => roles.includes(r));
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <img
            src="/rbb-logo.jpg"
            alt="RBBMBL"
            className="h-10 w-10 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 transition-all shrink-0 rounded-md object-contain"
          />
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold tracking-wide">RBBMBL</span>
            <span className="text-[11px] text-sidebar-foreground/60">RTA / RTS · Console</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((s) => {
          if (!canSee(s.roles)) return null;
          const visibleItems = s.items.filter((item) => canSee(item.roles));
          if (visibleItems.length === 0) return null;
          return (
            <SidebarGroup key={s.label}>
              <SidebarGroupLabel>{s.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                        <Link to={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="px-2 py-1.5 text-[11px] text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
          Developed by @Er. Sudeep Das
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

