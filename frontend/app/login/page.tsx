"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowRight, LogIn } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from "@/components/ui";
import { useAuth } from "@/lib/auth/auth-context";
import { loginSchema, type LoginInput } from "@/lib/schemas/forms";
import { MotifScatter } from "@/components/ui/hostel-motif";

function LoginBand() {
  return (
    <div className="relative overflow-hidden bg-blue-bauhaus text-white lg:w-1/2">
      <MotifScatter variant="hero" className="hidden lg:block" />
      <div className="relative mx-auto flex max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 lg:h-full lg:min-h-[calc(100vh-8rem)] lg:px-8">
        {/* Small-screen motif: the old floating circle, now on-theme. */}
        <MotifScatter variant="chat" className="lg:hidden" />
        <p className="text-xs font-bold uppercase tracking-widest text-white/80">Welcome back</p>
        <h1 className="mt-4 max-w-md text-4xl font-black uppercase leading-[0.9] tracking-tighter sm:text-6xl">
          The block
          <br />
          is open.
        </h1>
        <p className="mt-6 max-w-sm font-medium leading-relaxed text-white/90">
          Verified residents trade inside the hostel — escrow-protected, PIN-verified,
          no strangers at the door.
        </p>
      </div>
    </div>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";      const { login } = useAuth();
      const [serverError, setServerError] = React.useState<string | null>(null);
      const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
      } = useForm<LoginInput>({
        resolver: zodResolver(loginSchema),
        mode: "onBlur",
      });

      const onSubmit = handleSubmit(async (values) => {
        setServerError(null);
        try {
          const user = await login(values);
          const isAdmin = user?.role === 'admin';
          const target = isAdmin ? '/admin' : next;
          router.push(target);
        } catch (err) {
          setServerError(err instanceof Error ? err.message : "LOGIN FAILED — TRY AGAIN");
        }
      });

    return (
      <div className="mx-auto w-full max-w-md">
      <Card className="relative shadow-xl">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <p className="mt-1 text-sm font-medium text-foreground/70">
            New here?{" "}
            <Link
              href={`/register${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="font-bold uppercase tracking-wide underline decoration-2 underline-offset-4 hover:text-blue-bauhaus"
            >
              Create an account
            </Link>
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Input label="College email" type="email" autoComplete="email" placeholder="you@vitapstudent.ac.in" {...register("email")} />
            {errors.email ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.email.message}</p> : null}
            <Input label="Password" type="password" autoComplete="current-password" {...register("password")} />
            {errors.password ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.password.message}</p> : null}
            {serverError ? (
              <p role="alert" className="border-2 border-black bg-red-bauhaus px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
                {serverError}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              loading={isSubmitting}
              leftIcon={<LogIn className="h-5 w-5" aria-hidden="true" />}
            >
              Log in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense
      fallback={
        <main className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto h-96 w-full max-w-md animate-pulse border-2 border-black bg-muted" />
        </main>
      }
    >
      <LoginShell />
    </React.Suspense>
  );
}

function LoginShell() {
  return (
    <main id="main">
      <div className="flex flex-col lg:flex-row">
        <LoginBand />
        <div className="flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:w-1/2 lg:py-24">
          {/* Own boundary: only the form bails to client render for search
           * params — the motif band beside it still prerenders. */}
          <React.Suspense
            fallback={<div className="h-96 w-full max-w-md animate-pulse border-2 border-black bg-muted" />}
          >
            <LoginPageInner />
          </React.Suspense>
        </div>
      </div>
      <div className="border-t-4 border-black bg-yellow-bauhaus">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          <p className="text-xs font-bold uppercase tracking-widest">
            Simple sign-in — your college email and password are all you need.
          </p>
        </div>
      </div>
    </main>
  );
}
