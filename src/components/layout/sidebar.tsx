"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { useClients } from "@/hooks/use-metrics";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFilterQuery } from "@/hooks/use-url-filters";
import { isAgencyRole, isAdminRole, roleLabel } from "@/lib/auth/roles";
import { signOutAndRedirect } from "@/lib/auth/sign-out";
import { cn } from "@/lib/utils";
import { BiGridAlt, BiFile, BiMessageRounded, BiChevronLeft, BiChevronRight, BiData, BiRefresh, BiCheck, BiChevronDown, BiBuildings, BiError, BiTachometer, BiFilterAlt, BiSliderAlt, BiPulse, BiBell, BiTransferAlt, BiImage, BiCoinStack, BiGroup, BiLogOut } from "react-icons/bi";
import { Logo } from "@/components/brand/logo";
import { useQueryClient } from "@tanstack/react-query";
import { VIEWS } from "@/store/app-store";
import type { AppRole } from "@/lib/types/database";

type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
};

/** Extracts the active client + view from `/[clientId]/[view]` and preserves
 * the current filter query so nav/client links keep date & platform state. */
function useNavContext() {
  const params = useParams();
  const pathname = usePathname();
  const filterQuery = useFilterQuery();
  const clientId = typeof params.clientId === "string" ? params.clientId : "";
  const currentView = pathname.split("/")[2] || VIEWS.dashboard;
  return { clientId, currentView, filterQuery };
}

function SeedControl({ collapsed }: { collapsed: boolean }) {
  const [isSeeding, setIsSeeding] = useState(false);
  const [isSeeded, setIsSeeded] = useState(false);
  const queryClient = useQueryClient();

  async function handleSeed(force = false) {
    setIsSeeding(true);
    try {
      const res = await fetch("/api/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (data.seeded || data.message?.includes("already")) {
        setIsSeeded(true);
        queryClient.invalidateQueries();
      }
    } catch (error) {
      console.error("Seeding failed:", error);
    } finally {
      setIsSeeding(false);
    }
  }

  if (isSeeded) {
    return (
      <button
        disabled
        className={cn(
          "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-xs text-emerald-600",
          collapsed && "justify-center px-0"
        )}
      >
        <BiCheck className="w-4 h-4 shrink-0" />
        {!collapsed && <span>Data ready</span>}
      </button>
    );
  }

  return (
    <button
      onClick={() => handleSeed(false)}
      disabled={isSeeding}
      className={cn(
        "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-xs text-ink-muted hover:text-ink hover:bg-canvas-soft transition-colors",
        collapsed && "justify-center px-0"
      )}
    >
      {isSeeding ? (
        <BiRefresh className="w-4 h-4 shrink-0 animate-spin" />
      ) : (
        <BiData className="w-4 h-4 shrink-0" />
      )}
      {!collapsed && <span>{isSeeding ? "Seeding…" : "Seed demo data"}</span>}
    </button>
  );
}

function ClientSwitcher({ collapsed }: { collapsed: boolean }) {
  const { data: clients } = useClients();
  const { clientId, currentView, filterQuery } = useNavContext();
  const [isOpen, setIsOpen] = useState(false);

  const selectedClient = clients?.find((c) => c.id === clientId);
  // The server already filters clients to those the caller may access. With a
  // single option there's nothing to switch between, so render it as a static
  // label rather than a (misleading) dropdown.
  const isSingleClient = !!clients && clients.length === 1;

  if (collapsed) {
    return (
      <div className="px-2">
        <button
          onClick={() => !isSingleClient && setIsOpen(!isOpen)}
          className={cn(
            "w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold transition-colors",
            !isSingleClient && "hover:bg-primary/15",
            isSingleClient && "cursor-default"
          )}
          title={selectedClient?.name || "Select client"}
        >
          {selectedClient ? selectedClient.name.charAt(0) : "?"}
        </button>
      </div>
    );
  }

  if (isSingleClient) {
    return (
      <div className="px-3">
        <div className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg bg-canvas-soft border border-transparent">
          <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
            {selectedClient ? selectedClient.name.charAt(0) : <BiBuildings className="w-3.5 h-3.5" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink truncate">
              {selectedClient?.name || "—"}
            </p>
            {selectedClient && (
              <p className="text-[11px] text-ink-muted truncate capitalize">{selectedClient.industry}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg bg-canvas-soft hover:bg-hairline/50 border border-transparent hover:border-hairline transition-all text-left group"
      >
        <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
          {selectedClient ? selectedClient.name.charAt(0) : <BiBuildings className="w-3.5 h-3.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink truncate">
            {selectedClient?.name || "Select Client"}
          </p>
          {selectedClient && (
            <p className="text-[11px] text-ink-muted truncate capitalize">{selectedClient.industry}</p>
          )}
        </div>
        <BiChevronDown className={cn("w-3.5 h-3.5 text-ink-muted transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && clients && clients.length > 0 && (
        <div className="absolute left-3 right-3 top-full mt-1 bg-white border border-hairline rounded-lg shadow-(--shadow-elevated) z-50 py-1 max-h-60 overflow-y-auto">
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/${client.id}/${currentView}${filterQuery}`}
              onClick={() => setIsOpen(false)}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left hover:bg-canvas-soft transition-colors",
                client.id === clientId && "bg-primary/5 text-primary"
              )}
            >
              <div className={cn(
                "w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold shrink-0",
                client.id === clientId ? "bg-primary/10 text-primary" : "bg-canvas-soft text-ink-muted"
              )}>
                {client.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{client.name}</p>
                <p className="text-[11px] text-ink-muted capitalize">{client.industry}</p>
              </div>
              {client.id === clientId && (
                <BiCheck className="w-4 h-4 text-primary shrink-0" />
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UserFooter({
  collapsed,
  email,
  role,
}: {
  collapsed: boolean;
  email?: string | null;
  role?: AppRole;
}) {
  const [signingOut, setSigningOut] = useState(false);

  function handleSignOut() {
    setSigningOut(true);
    void signOutAndRedirect();
  }

  const initial = (email?.charAt(0) || "?").toUpperCase();

  if (collapsed) {
    return (
      <div className="px-2 pt-1">
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          title={`${email ?? "Signed in"} — sign out`}
          className="w-9 h-9 rounded-lg bg-canvas-soft text-ink flex items-center justify-center text-sm font-semibold hover:bg-hairline/60 transition-colors mx-auto"
        >
          {signingOut ? <BiRefresh className="w-4 h-4 animate-spin" /> : initial}
        </button>
      </div>
    );
  }

  return (
    <div className="px-1 pt-1 flex items-center gap-2">
      <div className="w-7 h-7 rounded-md bg-canvas-soft text-ink flex items-center justify-center text-xs font-semibold shrink-0">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-ink truncate">{email ?? "Signed in"}</p>
        {role && (
          <span className="text-[11px] font-medium text-ink-muted bg-canvas-soft px-1.5 py-0.5 rounded">
            {roleLabel(role)}
          </span>
        )}
      </div>
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        title="Sign out"
        className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-canvas-soft transition-colors shrink-0"
      >
        {signingOut ? <BiRefresh className="w-4 h-4 animate-spin" /> : <BiLogOut className="w-4 h-4" />}
      </button>
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const toggleChat = useAppStore((s) => s.toggleChat);
  const isChatOpen = useAppStore((s) => s.isChatOpen);
  const { clientId, currentView, filterQuery } = useNavContext();
  const { data: me } = useCurrentUser();
  const { data: clients } = useClients();
  const role = me?.profile.role;
  const isAgency = isAgencyRole(role);
  const isAdmin = isAdminRole(role);
  // Attribution & creatives run entirely on fabricated demo data (see
  // src/components/dashboard/demo-only.tsx) — hide them for real clients.
  const isDemoClient = clients?.find((c) => c.id === clientId)?.is_demo !== false;

  const navItems: NavItem[] = [
    { id: VIEWS.dashboard, label: "Dashboard", icon: <BiGridAlt className="w-4 h-4" /> },
    { id: VIEWS.anomalies, label: "Anomalies", icon: <BiError className="w-4 h-4" /> },
    { id: VIEWS.pacing, label: "Pacing", icon: <BiTachometer className="w-4 h-4" /> },
    { id: VIEWS.funnel, label: "Funnel", icon: <BiFilterAlt className="w-4 h-4" /> },
    { id: VIEWS.optimizer, label: "Channel mix", icon: <BiSliderAlt className="w-4 h-4" /> },
    { id: VIEWS.attribution, label: "Attribution", icon: <BiCoinStack className="w-4 h-4" /> },
    { id: VIEWS.health, label: "Health score", icon: <BiPulse className="w-4 h-4" /> },
    { id: VIEWS.creatives, label: "Creatives", icon: <BiImage className="w-4 h-4" /> },
    { id: VIEWS.compare, label: "Compare", icon: <BiTransferAlt className="w-4 h-4" /> },
    { id: VIEWS.alerts, label: "Alerts", icon: <BiBell className="w-4 h-4" /> },
    { id: VIEWS.reports, label: "Reports", icon: <BiFile className="w-4 h-4" /> },
    { id: VIEWS.team, label: "Team", icon: <BiGroup className="w-4 h-4" /> },
  ];

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-white border-r border-hairline shrink-0 transition-[width] duration-200 ease-in-out relative",
        collapsed ? "w-[56px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className={cn("flex items-center h-14 shrink-0 border-b border-hairline", collapsed ? "justify-center px-0" : "px-4")}>
        <Logo markSize={30} showWordmark={!collapsed} />
      </div>

      {/* Client Switcher */}
      <div className="py-3 border-b border-hairline">
        <ClientSwitcher collapsed={collapsed} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {navItems
          .filter((item) => {
            if (item.id === VIEWS.alerts) return isAgency;
            if (item.id === VIEWS.team) return isAdmin;
            if (item.id === VIEWS.attribution || item.id === VIEWS.creatives) return isDemoClient;
            return true;
          })
          .map((item) => {
            const active = item.id === currentView;
            return (
              <Link
                key={item.id}
                href={`/${clientId}/${item.id}${filterQuery}`}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-md text-sm transition-colors",
                  collapsed ? "justify-center px-0 py-2.5" : "px-2.5 py-2",
                  active
                    ? "bg-primary/8 text-primary font-medium"
                    : "text-ink-muted hover:text-ink hover:bg-canvas-soft"
                )}
              >
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}

        <button
          onClick={toggleChat}
          className={cn(
            "flex items-center gap-2.5 w-full rounded-md text-sm transition-colors",
            collapsed ? "justify-center px-0 py-2.5" : "px-2.5 py-2",
            isChatOpen
              ? "bg-primary/8 text-primary font-medium"
              : "text-ink-muted hover:text-ink hover:bg-canvas-soft"
          )}
        >
          <BiMessageRounded className="w-4 h-4" />
          {!collapsed && <span>AI assistant</span>}
        </button>
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-hairline py-3 px-2 space-y-1">
        {isAdminRole(role) && <SeedControl collapsed={collapsed} />}
        <UserFooter collapsed={collapsed} email={me?.user.email} role={role} />
      </div>

      {/* Collapse Toggle */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-white border-hairline shadow-sm z-10 hover:bg-canvas-soft"
      >
        {collapsed ? <BiChevronRight className="w-3.5 h-3.5" /> : <BiChevronLeft className="w-3.5 h-3.5" />}
      </Button>
    </aside>
  );
}
