"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search, X, ShieldAlert, ArrowLeft, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { GeometricLogo } from "@/components/layout/geometric-logo";
import { Button } from "@/components/ui/button";
import { ProfileDialog } from "@/components/profile/profile-dialog";
import { useAuth } from "@/lib/auth/auth-context";
import { useNotifications } from "@/lib/api/queries";

/**
 * Only reachable once authenticated. The marketplace is a gated product: a
 * logged-out visitor sees the login/create-account gateway and nothing else —
 * no Market, Dashboard, Sell or Purchases links at all.
 */
const NAV = [
  { href: "/", label: "Market" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/my-orders", label: "Orders" },
  { href: "/sell/new", label: "Sell" },
];

export function SiteHeader() {
  const { user, status, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const authed = status === "authenticated";
  const isAdmin = authed && user?.role === "admin";
  // Admin-console pages already offer "View Market Grid", so the return button
  // only shows once an admin has actually left the console.
  const onAdminConsole = pathname === "/admin" || pathname.startsWith("/admin/");
  const showReturnToConsole = isAdmin && !onAdminConsole;

  // Only poll notifications for logged-in users — otherwise the 401 refresh
  // flow would hijack public pages (brief risk note).
  const { data: notifData } = useNotifications(authed);
  const notifications = notifData?.notifications ?? [];
  const unread = authed ? notifications.filter((n) => !n.readAt).length : 0;

  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b-4 border-black bg-background">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href={authed ? "/" : "/login"} aria-label="Hostel Marketplace home" className="flex items-center">
          <GeometricLogo />
        </Link>

        {/* Authenticated-only primary navigation */}
        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {authed
            ? NAV.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "relative py-2 text-sm font-bold uppercase tracking-widest transition-colors",
                      "after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:bg-red-bauhaus after:transition-transform after:duration-200",
                      active ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })
            : null}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {authed ? (
            <>
              <Link
                href="/"
                aria-label="Search listings"
                className="press flex h-10 w-10 items-center justify-center border-2 border-black bg-white shadow-sm"
              >
                <Search className="h-5 w-5" aria-hidden="true" />
              </Link>

              {/* PURCHASES — authenticated-only top-right item */}
              <Link
                href="/purchases"
                aria-label="Purchases history"
                title="Purchases"
                className={cn(
                  "press flex h-10 items-center justify-center border-2 border-black px-3 shadow-sm",
                  pathname === "/purchases" ? "bg-yellow-bauhaus" : "bg-white",
                )}
              >
                <span className="text-[10px] font-black uppercase tracking-widest">Purchases</span>
              </Link>

              {/* PROFILE — opens the user's own details + purchases shortcut */}
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                aria-label="Profile"
                title="Profile"
                className={cn(
                  "press flex h-10 items-center justify-center gap-2 border-2 border-black px-3 shadow-sm",
                  profileOpen ? "bg-yellow-bauhaus" : "bg-white",
                )}
              >
                <UserRound className="h-4 w-4" aria-hidden="true" />
                <span className="text-[10px] font-black uppercase tracking-widest">Profile</span>
              </button>

              <Link
                href="/dashboard?tab=notifications"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                className="press relative flex h-10 w-10 items-center justify-center border-2 border-black bg-white shadow-sm"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unread > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center border-2 border-black bg-yellow-bauhaus px-1 text-[10px] font-black">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </Link>

              {/* ADMIN ONLY — back to the console from anywhere in the market */}
              {showReturnToConsole ? (
                <Link href="/admin" aria-label="Back to admin console">
                  <Button
                    variant="yellow"
                    size="sm"
                    leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
                  >
                    Admin Console
                  </Button>
                </Link>
              ) : null}

              {isAdmin && onAdminConsole ? (
                <Link
                  href="/admin"
                  className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-black/60"
                >
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                  Admin
                </Link>
              ) : null}

              <button
                type="button"
                onClick={() => void logout()}
                className="text-xs font-bold uppercase tracking-widest underline decoration-2 underline-offset-4 hover:text-red-bauhaus"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="outline" size="sm">Log in</Button>
              </Link>
              <Link href="/register">
                <Button variant="primary" size="sm">Create account</Button>
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="press flex h-10 w-10 flex-col items-center justify-center gap-1.5 border-2 border-black bg-white shadow-sm md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <X className="h-5 w-5" aria-hidden="true" />
          ) : (
            <>
              <span aria-hidden="true" className="block h-1 w-5 bg-foreground" />
              <span aria-hidden="true" className="block h-1 w-5 bg-foreground" />
            </>
          )}
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t-4 border-black bg-foreground md:hidden">
          <nav aria-label="Mobile" className="flex flex-col gap-1 p-4">
            {authed
              ? NAV.map((item, i) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 py-3 text-2xl font-black uppercase tracking-tight text-white"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-block h-4 w-4 border-2 border-black",
                        i % 3 === 0 && "rounded-full bg-red-bauhaus",
                        i % 3 === 1 && "bg-blue-bauhaus",
                        i % 3 === 2 && "shape-triangle bg-yellow-bauhaus",
                      )}
                    />
                    {item.label}
                  </Link>
                ))
              : null}

            <div className="mt-4 flex flex-col gap-3">
              {authed ? (
                <>
                  {showReturnToConsole ? (
                    <Link href="/admin">
                      <Button variant="yellow" className="w-full">
                        Back to Admin Console
                      </Button>
                    </Link>
                  ) : null}
                  <Link href="/purchases">
                    <Button variant="outline" className="w-full">Purchases</Button>
                  </Link>
                  <Button variant="outline" className="w-full" onClick={() => setProfileOpen(true)}>
                    Profile
                  </Button>
                  <Link href="/sell/new">
                    <Button variant="yellow" className="w-full">Sell</Button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="text-left text-sm font-bold uppercase tracking-widest text-yellow-bauhaus underline decoration-2 underline-offset-4"
                  >
                    Log out
                  </button>
                </>
              ) : (
                <>
                  <Link href="/login">
                    <Button variant="outline" className="w-full">Log in</Button>
                  </Link>
                  <Link href="/register">
                    <Button variant="primary" className="w-full">Create account</Button>
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      ) : null}

      {authed ? <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} /> : null}
    </header>
  );
}
