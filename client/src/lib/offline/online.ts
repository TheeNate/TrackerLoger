import { useEffect, useState } from "react";
import { onlineManager, useIsMutating, useMutationState } from "@tanstack/react-query";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function setupOnlineManager() {
  if (typeof window === "undefined") return;
  onlineManager.setEventListener((setOnline) => {
    const handler = () => setOnline(navigator.onLine);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
    };
  });
}

export function usePendingSyncCount(): number {
  // Count paused mutations (offline) plus currently in-flight mutations.
  const paused = useMutationState({
    filters: { status: "pending" },
  }).length;
  const inFlight = useIsMutating();
  return Math.max(paused, inFlight);
}
