import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useOnlineStatus } from "@/lib/offline/online";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Award, Bell } from "lucide-react";
import type { Notification } from "@shared/schema";

type Feed = { items: Notification[]; unread: number };

function timeAgo(d: Date | string | null) {
  if (!d) return "";
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// The bell: technicians who just qualified for a certification level. Site
// admins always see it; org admins see it once they've had an alert.
export function NotificationBell() {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const [, setLocation] = useLocation();
  const enabled = !!user && !user.impersonating;
  const { data } = useQuery<Feed>({
    queryKey: ["/api/notifications"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: enabled && online,
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (id?: number) => apiRequest("POST", "/api/notifications/read", id ? { id } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  if (!enabled || (!user.isAdmin && !data?.items.length)) return null;
  const unread = data?.unread ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button type="button" className="h-8 text-xs text-primary hover:underline" onClick={() => markRead.mutate(undefined)}>
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!data?.items.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing yet. You'll be told here and by email when someone qualifies for a new certification.
            </p>
          ) : (
            data.items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  if (n.link) setLocation(n.link);
                }}
                className={`flex w-full gap-2 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted/50 ${n.readAt ? "" : "bg-primary/5"}`}
              >
                <Award className={`mt-0.5 h-4 w-4 shrink-0 ${n.readAt ? "text-muted-foreground" : "text-primary"}`} />
                <span className="min-w-0">
                  <span className={`block text-sm ${n.readAt ? "" : "font-semibold"}`}>{n.title}</span>
                  {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="block text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
