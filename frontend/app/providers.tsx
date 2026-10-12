"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ToastProvider } from "@/components/ui/toast";
import { SocketProvider } from "@/lib/socket/socket-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <SocketProvider>{children}</SocketProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
