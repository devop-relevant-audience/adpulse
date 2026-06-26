"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { useClients } from "@/hooks/use-metrics";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Zap,
  Database,
  Loader2,
  Check,
  ChevronDown,
  Building2,
  AlertTriangle,
  Gauge,
  Funnel,
  Sliders,
  HeartPulse,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { VIEWS, type ViewId } from "@/store/app-store";

type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
};

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
        <Check className="w-4 h-4 shrink-0" />
        {!collapsed && <span>Data Ready</span>}
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
        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
      ) : (
        <Database className="w-4 h-4 shrink-0" />
      )}
      {!collapsed && <span>{isSeeding ? "Seeding..." : "Seed Demo Data"}</span>}
    </button>
  );
}

function ClientSwitcher({ collapsed }: { collapsed: boolean }) {
  const { data: clients } = useClients();
  const selectedClientId = useAppStore((s) => s.selectedClientId);
  const setSelectedClientId = useAppStore((s) => s.setSelectedClientId);
  const [isOpen, setIsOpen] = useState(false);

  const selectedClient = clients?.find((c) => c.id === selectedClientId);

  if (collapsed) {
    return (
      <div className="px-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold hover:bg-primary/15 transition-colors"
          title={selectedClient?.name || "Select client"}
        >
          {selectedClient ? selectedClient.name.charAt(0) : "?"}
        </button>
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
          {selectedClient ? selectedClient.name.charAt(0) : <Building2 className="w-3.5 h-3.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink truncate">
            {selectedClient?.name || "Select Client"}
          </p>
          {selectedClient && (
            <p className="text-[11px] text-ink-muted truncate capitalize">{selectedClient.industry}</p>
          )}
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-ink-muted transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && clients && clients.length > 0 && (
        <div className="absolute left-3 right-3 top-full mt-1 bg-white border border-hairline rounded-lg shadow-(--shadow-elevated) z-50 py-1 max-h-60 overflow-y-auto">
          {clients.map((client) => (
            <button
              key={client.id}
              onClick={() => {
                setSelectedClientId(client.id);
                setIsOpen(false);
              }}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left hover:bg-canvas-soft transition-colors",
                client.id === selectedClientId && "bg-primary/5 text-primary"
              )}
            >
              <div className={cn(
                "w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold shrink-0",
                client.id === selectedClientId ? "bg-primary/10 text-primary" : "bg-canvas-soft text-ink-muted"
              )}>
                {client.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{client.name}</p>
                <p className="text-[11px] text-ink-muted capitalize">{client.industry}</p>
              </div>
              {client.id === selectedClientId && (
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const toggleChat = useAppStore((s) => s.toggleChat);
  const isChatOpen = useAppStore((s) => s.isChatOpen);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const navItems: NavItem[] = [
    {
      id: VIEWS.dashboard,
      label: "Dashboard",
      icon: <LayoutDashboard className="w-4 h-4" />,
      active: activeView === VIEWS.dashboard,
      onClick: () => setActiveView(VIEWS.dashboard),
    },
    {
      id: VIEWS.anomalies,
      label: "Anomalies",
      icon: <AlertTriangle className="w-4 h-4" />,
      active: activeView === VIEWS.anomalies,
      onClick: () => setActiveView(VIEWS.anomalies),
    },
    {
      id: VIEWS.pacing,
      label: "Pacing",
      icon: <Gauge className="w-4 h-4" />,
      active: activeView === VIEWS.pacing,
      onClick: () => setActiveView(VIEWS.pacing),
    },
    {
      id: VIEWS.funnel,
      label: "Funnel",
      icon: <Funnel className="w-4 h-4" />,
      active: activeView === VIEWS.funnel,
      onClick: () => setActiveView(VIEWS.funnel),
    },
    {
      id: VIEWS.optimizer,
      label: "Channel Mix",
      icon: <Sliders className="w-4 h-4" />,
      active: activeView === VIEWS.optimizer,
      onClick: () => setActiveView(VIEWS.optimizer),
    },
    {
      id: VIEWS.health,
      label: "Health Score",
      icon: <HeartPulse className="w-4 h-4" />,
      active: activeView === VIEWS.health,
      onClick: () => setActiveView(VIEWS.health),
    },
    {
      id: VIEWS.reports,
      label: "Reports",
      icon: <FileText className="w-4 h-4" />,
      active: activeView === VIEWS.reports,
      onClick: () => setActiveView(VIEWS.reports),
    },
  ];

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-white border-r border-hairline shrink-0 transition-[width] duration-200 ease-in-out relative",
        collapsed ? "w-[56px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className={cn("flex items-center h-14 shrink-0 border-b border-hairline", collapsed ? "justify-center px-0" : "px-4 gap-2.5")}>
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary shrink-0">
          <Zap className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <span className="text-[15px] font-bold tracking-tight select-none text-ink">
            AdPulse
          </span>
        )}
      </div>

      {/* Client Switcher */}
      <div className="py-3 border-b border-hairline">
        <ClientSwitcher collapsed={collapsed} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={item.onClick}
            className={cn(
              "flex items-center gap-2.5 w-full rounded-md text-sm transition-colors",
              collapsed ? "justify-center px-0 py-2.5" : "px-2.5 py-2",
              item.active
                ? "bg-primary/8 text-primary font-medium"
                : "text-ink-muted hover:text-ink hover:bg-canvas-soft"
            )}
          >
            {item.icon}
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}

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
          <MessageCircle className="w-4 h-4" />
          {!collapsed && <span>AI Assistant</span>}
        </button>
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-hairline py-3 px-2 space-y-1">
        <SeedControl collapsed={collapsed} />
      </div>

      {/* Collapse Toggle */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-white border-hairline shadow-sm z-10 hover:bg-canvas-soft"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </Button>
    </aside>
  );
}
