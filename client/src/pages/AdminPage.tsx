import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { User } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Search, Shield, SlidersHorizontal, Trophy, UserPlus, Users } from "lucide-react";
import { useLocation } from "wouter";
import { AdminViewToggle } from "@/components/admin/AdminViewToggle";
import { UserDetailPanel } from "@/components/admin/UserDetailPanel";
import { AddUserDialog } from "@/components/admin/AddUserDialog";
import { ProgressBoard } from "@/components/admin/ProgressBoard";
import { CertRequirementsEditor } from "@/components/admin/CertRequirementsEditor";
import { NotificationBell } from "@/components/admin/NotificationBell";
import { HOME_PATH, ROPE_ONLY } from "@/lib/edition";

type AdminTab = "progress" | "users" | "requirements";
// Requirements are the NDT numbers, so the rope logbook doesn't have them.
const TABS = ([
  { id: "progress", label: "Progress", icon: Trophy },
  { id: "users", label: "Users", icon: Users },
  { id: "requirements", label: "Requirements", icon: SlidersHorizontal },
] as { id: AdminTab; label: string; icon: typeof Users }[]).filter((t) => !(ROPE_ONLY && t.id === "requirements"));

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<AdminTab>("progress");

  // Redirect non-admins away.
  useEffect(() => {
    if (!authLoading && user && !user.isAdmin) {
      setLocation(HOME_PATH);
    }
  }, [user, authLoading, setLocation]);

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!user?.isAdmin,
  });

  // Default the selection to the first user once loaded. On a phone the list
  // and the detail don't fit side by side, so nothing is preselected there.
  useEffect(() => {
    if (!isMobile && selectedUserId === null && users && users.length > 0) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUserId, isMobile]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user?.isAdmin) return null;

  const filtered = users?.filter(
    (u) =>
      u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.employeeNumber?.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  // Phones show either the list or one user's detail.
  const showDetailOnly = isMobile && selectedUserId !== null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur pt-safe md:static md:bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 md:py-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Admin
          </h1>
          <div className="flex items-center gap-1 md:gap-2">
            <NotificationBell />
            <AdminViewToggle />
          </div>
        </div>
        <nav
          className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid ${TABS.length === 2 ? "grid-cols-2" : "grid-cols-3"} md:flex md:gap-6`}
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`h-11 md:h-auto md:py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap flex items-center justify-center gap-2 ${
                tab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 pb-safe">
        {tab === "progress" && (
          <ProgressBoard
            endpoint="/api/admin/progress"
            onSelectUser={(id) => {
              setSelectedUserId(id);
              setTab("users");
            }}
          />
        )}
        {tab === "requirements" && <CertRequirementsEditor />}
        {tab === "users" && (
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 md:gap-6">
            {/* User list */}
            {!showDetailOnly && (
              <aside className="rounded-xl md:rounded-lg border border-border bg-card shadow-sm p-4 h-fit">
                <Button className="w-full mb-3 h-11 md:h-9" onClick={() => setAddOpen(true)}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add user
                </Button>
                <div className="flex items-center gap-2 mb-3">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-11 md:h-9"
                  />
                </div>
                {usersLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : !filtered || filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No users found.</p>
                ) : (
                  <div className="space-y-1 lg:max-h-[70vh] lg:overflow-y-auto">
                    {filtered.map((u) => {
                      const active = u.id === selectedUserId;
                      return (
                        <button
                          key={u.id}
                          onClick={() => setSelectedUserId(u.id)}
                          className={`w-full text-left rounded-md px-3 py-2.5 md:py-2 transition-colors ${
                            active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate">{u.name || u.email}</span>
                            {u.isAdmin && <Shield className="h-3.5 w-3.5 text-primary shrink-0" />}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {users?.length ?? 0} total
                </div>
              </aside>
            )}

            {/* Detail */}
            {(!isMobile || showDetailOnly) && (
              <section className="rounded-xl md:rounded-lg border border-border bg-card shadow-sm p-4 md:p-6 min-h-[400px] min-w-0">
                {showDetailOnly && (
                  <Button variant="ghost" className="-ml-2 mb-2 h-10" onClick={() => setSelectedUserId(null)}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    All users
                  </Button>
                )}
                {selectedUserId ? (
                  <UserDetailPanel
                    key={selectedUserId}
                    userId={selectedUserId}
                    currentAdminId={user.id}
                    onDeleted={() => setSelectedUserId(null)}
                  />
                ) : (
                  <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                    Select a user to view their details.
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>

      <AddUserDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => {
          setSelectedUserId(id);
          setTab("users");
        }}
      />
    </div>
  );
}
