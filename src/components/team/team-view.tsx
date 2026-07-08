"use client";

import { useMemo, useState } from "react";
import {
  Users,
  Plus,
  Loader2,
  X,
  Trash2,
  Pencil,
  AlertTriangle,
  Building2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useClients } from "@/hooks/use-metrics";
import {
  useTeam,
  useInviteUser,
  useUpdateUser,
  useRemoveUser,
  type TeamUser,
} from "@/hooks/use-team";
import { roleLabel } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/types/database";

const ROLE_OPTIONS: AppRole[] = ["agency_admin", "agency_member", "client_user"];

const ROLE_BADGE: Record<AppRole, "default" | "secondary" | "outline"> = {
  agency_admin: "default",
  agency_member: "secondary",
  client_user: "outline",
};

function RoleBadge({ role }: { role: AppRole }) {
  return <Badge variant={ROLE_BADGE[role]}>{roleLabel(role)}</Badge>;
}

// Checkbox list of clients — used when assigning a client_user. Plain styled
// elements (no Radix); matches the recipients pattern in alerts-manager.
function ClientMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: clients, isLoading } = useClients();

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]);
  }

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (!clients || clients.length === 0) {
    return (
      <p className="text-[12px] text-ink-muted rounded-lg border border-hairline px-3 py-2">
        No clients available to assign.
      </p>
    );
  }

  return (
    <div className="max-h-44 overflow-y-auto rounded-lg border border-hairline divide-y divide-hairline">
      {clients.map((client) => (
        <label
          key={client.id}
          className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-canvas-soft transition-colors"
        >
          <input
            type="checkbox"
            checked={selected.includes(client.id)}
            onChange={() => toggle(client.id)}
            className="rounded border-hairline"
          />
          <div className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold shrink-0">
            {client.name.charAt(0)}
          </div>
          <span className="text-[13px] text-ink flex-1 min-w-0 truncate">{client.name}</span>
        </label>
      ))}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl border border-hairline shadow-xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-hairline">
          {footer}
        </div>
      </div>
    </div>
  );
}

const FIELD_LABEL = "text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1.5";

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: AppRole;
  onChange: (role: AppRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as AppRole)} disabled={disabled}>
      <SelectTrigger className="h-9 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_OPTIONS.map((r) => (
          <SelectItem key={r} value={r}>
            {roleLabel(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AppRole>("agency_member");
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const invite = useInviteUser();

  const needsClients = role === "client_user";
  const canSubmit =
    email.includes("@") && (!needsClients || clientIds.length > 0) && !invite.isPending;

  async function handleSubmit() {
    setError(null);
    try {
      await invite.mutateAsync({
        email: email.trim(),
        full_name: fullName.trim() || undefined,
        role,
        client_ids: needsClients ? clientIds : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite user");
    }
  }

  return (
    <ModalShell
      title="Invite member"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {invite.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            Send invite
          </Button>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[13px] text-destructive"
        >
          {error}
        </div>
      )}

      <div>
        <label className={FIELD_LABEL}>Email</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
        />
      </div>

      <div>
        <label className={FIELD_LABEL}>Full name (optional)</label>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
      </div>

      <div>
        <label className={FIELD_LABEL}>Role</label>
        <RoleSelect value={role} onChange={setRole} />
      </div>

      {needsClients && (
        <div>
          <label className={FIELD_LABEL}>Client access</label>
          <ClientMultiSelect selected={clientIds} onChange={setClientIds} />
          <p className="text-[11px] text-ink-muted mt-1.5">
            Client users only see the clients you assign here.
          </p>
        </div>
      )}
    </ModalShell>
  );
}

function EditDialog({ user, onClose }: { user: TeamUser; onClose: () => void }) {
  const { data: me } = useCurrentUser();
  const isSelf = me?.user.id === user.id;

  const [role, setRole] = useState<AppRole>(user.role);
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [clientIds, setClientIds] = useState<string[]>(user.clients.map((c) => c.id));
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateUser();

  const needsClients = role === "client_user";
  const canSubmit = (!needsClients || clientIds.length > 0) && !update.isPending;

  async function handleSubmit() {
    setError(null);
    try {
      await update.mutateAsync({
        user_id: user.id,
        // The API rejects changing your OWN role, so never send it for self.
        role: isSelf ? undefined : role,
        full_name: fullName.trim() || null,
        // Replace memberships to match the (possibly changed) role. Agency roles
        // clear memberships; a client_user gets exactly the selected clients.
        client_ids: needsClients ? clientIds : [],
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  }

  return (
    <ModalShell
      title="Edit member"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            Save changes
          </Button>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[13px] text-destructive"
        >
          {error}
        </div>
      )}

      <div>
        <label className={FIELD_LABEL}>Email</label>
        <Input value={user.email ?? ""} disabled />
      </div>

      <div>
        <label className={FIELD_LABEL}>Full name</label>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
      </div>

      <div>
        <label className={FIELD_LABEL}>Role</label>
        <RoleSelect value={role} onChange={setRole} disabled={isSelf} />
        {isSelf && (
          <p className="text-[11px] text-ink-muted mt-1.5">You cannot change your own role.</p>
        )}
      </div>

      {needsClients && (
        <div>
          <label className={FIELD_LABEL}>Client access</label>
          <ClientMultiSelect selected={clientIds} onChange={setClientIds} />
        </div>
      )}
    </ModalShell>
  );
}

function RemoveDialog({ user, onClose }: { user: TeamUser; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const remove = useRemoveUser();

  async function handleRemove() {
    setError(null);
    try {
      await remove.mutateAsync(user.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove user");
    }
  }

  return (
    <ModalShell
      title="Remove member"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleRemove} disabled={remove.isPending}>
            {remove.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            Remove
          </Button>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[13px] text-destructive"
        >
          {error}
        </div>
      )}
      <p className="text-[13px] text-ink">
        Remove <span className="font-medium">{user.email ?? user.full_name ?? "this user"}</span>?
        They will lose all access immediately. This cannot be undone.
      </p>
    </ModalShell>
  );
}

export function TeamView() {
  const { data: me } = useCurrentUser();
  const { data: users, isLoading, error } = useTeam();
  const selfId = me?.user.id;

  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<TeamUser | null>(null);
  const [removing, setRemoving] = useState<TeamUser | null>(null);

  const sorted = useMemo(
    () => [...(users ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [users]
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.5px] text-ink">Team</h1>
          <p className="text-[13px] text-ink-muted mt-0.5">
            Invite teammates and manage their roles and client access
          </p>
        </div>
        <Button size="sm" onClick={() => setInviting(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Invite member
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-[13px] text-destructive">
            {error instanceof Error ? error.message : "Failed to load team"}
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-10 h-10 text-ink-muted/40 mx-auto mb-3" />
          <p className="text-[13px] text-ink-muted">No team members yet.</p>
          <p className="text-[12px] text-ink-muted mt-1">
            Invite someone to give them access to the workspace.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-hairline overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-hairline">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9 pl-4">
                  Member
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9">
                  Role
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9">
                  Client access
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9">
                  Joined
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted h-9 pr-4 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((user) => {
                const isSelf = user.id === selfId;
                const isClientUser = user.role === "client_user";
                return (
                  <TableRow key={user.id} className="border-hairline">
                    <TableCell className="pl-4 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-md bg-canvas-soft text-ink flex items-center justify-center text-[11px] font-semibold shrink-0 uppercase">
                          {(user.email || user.full_name || "?").charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-ink truncate">
                            {user.full_name || user.email || "—"}
                            {isSelf && (
                              <span className="ml-1.5 text-[11px] font-normal text-ink-muted">
                                (You)
                              </span>
                            )}
                          </p>
                          {user.full_name && (
                            <p className="text-[11px] text-ink-muted truncate">{user.email}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={user.role} />
                    </TableCell>
                    <TableCell>
                      {!isClientUser ? (
                        <span className="text-[12px] text-ink-muted">All clients</span>
                      ) : user.clients.length === 0 ? (
                        <span className="text-[12px] text-amber-600">No clients</span>
                      ) : (
                        <div className="flex items-center gap-1 flex-wrap">
                          <Building2 className="w-3 h-3 text-ink-muted shrink-0" />
                          <span className="text-[12px] text-ink truncate max-w-[220px]">
                            {user.clients.map((c) => c.name).join(", ")}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-[12px] text-ink-muted tabular-nums">
                      {format(parseISO(user.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(user)}
                          title="Edit member"
                          className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-canvas-soft"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {!isSelf && (
                          <button
                            onClick={() => setRemoving(user)}
                            title="Remove member"
                            className={cn(
                              "p-1.5 rounded-md text-ink-muted hover:text-red-600 hover:bg-red-50"
                            )}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {editing && <EditDialog user={editing} onClose={() => setEditing(null)} />}
      {removing && <RemoveDialog user={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}
