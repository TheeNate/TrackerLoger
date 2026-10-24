import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProfileHeader } from "@/components/ProfileHeader";
import { Building2, UserPlus, Check, X, LogOut, Search, ChevronDown, ChevronRight, Users, Trophy, SlidersHorizontal } from "lucide-react";
import { ProgressBoard } from "@/components/admin/ProgressBoard";
import { CertRequirementsEditor } from "@/components/admin/CertRequirementsEditor";
import type { User, Entry, Organization } from "@shared/schema";
import type { UserOrgMembership, OrgMemberEntry } from "@/types";

export default function OrganizationsPage() {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Organization[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: user } = useQuery<User>({ queryKey: ["/api/user"] });
  const { data: entries = [] } = useQuery<Entry[]>({
    queryKey: ["/api/entries"],
    enabled: !!user,
  });
  const verifiedEntries = entries.filter((e) => e.verified);

  const { data: orgs = [], isLoading } = useQuery<UserOrgMembership[]>({
    queryKey: ["/api/organizations"],
    enabled: !!user,
  });

  const refreshOrgs = () => queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });

  const handleCreate = async () => {
    const name = newName.trim();
    if (name.length < 2) {
      toast({ title: "Name too short", description: "Enter an organization name.", variant: "destructive" });
      return;
    }
    try {
      const res = await apiRequest("POST", "/api/organizations", { name });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to create");
      toast({ title: "Organization created", description: `You're the admin of ${name}.` });
      setNewName("");
      refreshOrgs();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleSearch = async () => {
    const q = search.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const res = await apiRequest("GET", `/api/organizations/search?q=${encodeURIComponent(q)}`);
      setSearchResults(await res.json());
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const handleJoin = async (org: Organization) => {
    try {
      const res = await apiRequest("POST", `/api/organizations/${org.id}/join`, {});
      if (!res.ok) throw new Error((await res.json()).message || "Failed to request");
      toast({ title: "Request sent", description: `An admin of ${org.name} must approve you.` });
      setSearchResults((prev) => prev?.filter((o) => o.id !== org.id) ?? null);
      refreshOrgs();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleLeave = async (membershipId: number, name: string) => {
    try {
      const res = await apiRequest("DELETE", `/api/organizations/members/${membershipId}`);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to leave");
      toast({ title: "Left organization", description: `You left ${name}.` });
      refreshOrgs();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-neutral-100">
      <ProfileHeader user={user} verifiedEntries={verifiedEntries} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 md:pt-8 pb-mobile-nav space-y-4 md:space-y-6">
        {/* Create + Join */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-white rounded-xl md:rounded-lg shadow-sm p-4 md:p-6">
            <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2 mb-1">
              <Building2 className="h-5 w-5" />
              Create an organization
            </h2>
            <p className="text-sm text-neutral-500 mb-4">
              Members of an org share their signers. You'll be its admin and approve who joins.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Curtiss-Wright"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="h-12 text-base md:h-10 md:text-sm"
              />
              <Button onClick={handleCreate} className="h-12 md:h-10">Create</Button>
            </div>
          </div>

          <div className="bg-white rounded-xl md:rounded-lg shadow-sm p-4 md:p-6">
            <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2 mb-1">
              <Search className="h-5 w-5" />
              Join an organization
            </h2>
            <p className="text-sm text-neutral-500 mb-4">
              Search by name and request to join. An admin approves your request.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Search organizations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="h-12 text-base md:h-10 md:text-sm"
              />
              <Button variant="outline" onClick={handleSearch} disabled={searching} className="h-12 md:h-10">
                {searching ? "…" : "Search"}
              </Button>
            </div>
            {searchResults != null && (
              <div className="mt-3 space-y-2">
                {searchResults.length === 0 ? (
                  <p className="text-sm text-neutral-500">No new organizations found.</p>
                ) : (
                  searchResults.map((org) => (
                    <div
                      key={org.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{org.name}</span>
                      <Button size="sm" variant="outline" className="h-10 shrink-0 md:h-9" onClick={() => handleJoin(org)}>
                        <UserPlus className="h-4 w-4 mr-1" />
                        Request
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* My organizations */}
        <div className="bg-white rounded-xl md:rounded-lg shadow-sm p-4 md:p-6">
          <h2 className="text-lg font-semibold text-neutral-900 mb-4">My organizations</h2>
          {isLoading ? (
            <div className="text-center py-8 text-neutral-500">Loading…</div>
          ) : orgs.length === 0 ? (
            <div className="text-center py-10 border-2 border-dashed border-neutral-200 rounded-md text-neutral-500">
              You're not in any organizations yet. Create one or join an existing one above.
            </div>
          ) : (
            <div className="space-y-3">
              {orgs.map(({ organization, membership }) => {
                const isAdmin = membership.role === "admin" && membership.status === "active";
                const isOpen = expanded === organization.id;
                return (
                  <div key={organization.id} className="rounded-md border border-neutral-200">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 md:px-4 md:py-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {isAdmin && (
                          <button
                            onClick={() => setExpanded(isOpen ? null : organization.id)}
                            aria-label="Toggle organization admin"
                            className="-m-2 p-2 text-neutral-500"
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        )}
                        <span className="font-medium text-neutral-900">{organization.name}</span>
                        <span className="text-xs rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 capitalize">
                          {membership.role}
                        </span>
                        {membership.status === "pending" && (
                          <span className="text-xs rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                            Pending approval
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-10 shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50 md:h-9"
                        onClick={() => handleLeave(membership.id, organization.name)}
                      >
                        <LogOut className="h-4 w-4 mr-1" />
                        {membership.status === "pending" ? "Cancel" : "Leave"}
                      </Button>
                    </div>
                    {isAdmin && isOpen && <OrgAdminPanel orgId={organization.id} myUserId={user.id} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

type OrgTab = "members" | "progress" | "requirements";
const ORG_TABS: { id: OrgTab; label: string; icon: typeof Users }[] = [
  { id: "members", label: "Members", icon: Users },
  { id: "progress", label: "Progress", icon: Trophy },
  { id: "requirements", label: "Requirements", icon: SlidersHorizontal },
];

// What an org admin manages: members, their certification progress, and the
// org's own NDT OJT requirements (shared/certProgress.ts).
function OrgAdminPanel({ orgId, myUserId }: { orgId: number; myUserId: number }) {
  const [tab, setTab] = useState<OrgTab>("members");
  return (
    <div className="border-t border-neutral-200">
      <nav className="grid grid-cols-3 border-b border-neutral-200 md:flex md:gap-6 md:px-4">
        {ORG_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`flex h-11 items-center justify-center gap-1.5 border-b-2 px-1 text-sm font-medium ${
              tab === id ? "border-primary text-primary" : "border-transparent text-neutral-500"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>
      {tab === "members" && <MembersPanel orgId={orgId} myUserId={myUserId} />}
      {tab !== "members" && (
        <div className="bg-neutral-50 p-3 md:p-4 dark:bg-transparent">
          {tab === "progress" ? (
            <ProgressBoard endpoint={`/api/organizations/${orgId}/progress`} />
          ) : (
            <CertRequirementsEditor orgId={orgId} />
          )}
        </div>
      )}
    </div>
  );
}

function MembersPanel({ orgId, myUserId }: { orgId: number; myUserId: number }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ role: string; members: OrgMemberEntry[] }>({
    queryKey: [`/api/organizations/${orgId}/members`],
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/organizations/${orgId}/members`] });

  const approve = async (membershipId: number) => {
    try {
      const res = await apiRequest("POST", `/api/organizations/members/${membershipId}/approve`, {});
      if (!res.ok) throw new Error((await res.json()).message || "Failed to approve");
      toast({ title: "Member approved" });
      refresh();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const remove = async (membershipId: number) => {
    try {
      const res = await apiRequest("DELETE", `/api/organizations/members/${membershipId}`);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to remove");
      toast({ title: "Member removed" });
      refresh();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="px-4 py-3 text-sm text-neutral-500">Loading members…</div>;
  }
  const members = data?.members ?? [];
  const pending = members.filter((m) => m.membership.status === "pending");
  const active = members.filter((m) => m.membership.status === "active");

  return (
    <div className="px-4 py-3 space-y-4">
      {pending.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-amber-700 mb-2">Pending requests</p>
          <div className="space-y-2">
            {pending.map((m) => (
              <div key={m.membership.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{m.user.name || m.user.email}</span>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" className="h-10 md:h-9" onClick={() => approve(m.membership.id)}>
                    <Check className="h-4 w-4 mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10 text-red-600 hover:text-red-700 hover:bg-red-50 md:h-9"
                    onClick={() => remove(m.membership.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold uppercase text-neutral-500 mb-2">Members</p>
        <div className="space-y-2">
          {active.map((m) => (
            <div key={m.membership.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 break-all">
                {m.user.name || m.user.email}
                <span className="text-xs rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 capitalize">
                  {m.membership.role}
                </span>
              </span>
              {m.user.id !== myUserId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-10 shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50 md:h-9"
                  onClick={() => remove(m.membership.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
