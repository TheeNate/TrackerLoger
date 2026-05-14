import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // offlineFirst lets cached data render while offline instead of
      // surfacing a network error.
      networkMode: "offlineFirst",
      refetchInterval: false,
      refetchOnWindowFocus: false,
      // Allow rehydrated cache to be considered fresh briefly so the UI
      // doesn't flicker into error states on cold start.
      staleTime: 30 * 1000,
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days — needed for persistence
      retry: false,
    },
    mutations: {
      // Mutations pause when offline and resume on reconnect. Specific
      // mutations register their mutationFn via setMutationDefaults so
      // paused mutations can be replayed after a page reload.
      networkMode: "offlineFirst",
      retry: false,
    },
  },
});
