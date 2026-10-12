"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowRight, UserPlus } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Select,
  Stepper,
} from "@/components/ui";
import { MotifScatter } from "@/components/ui/hostel-motif";
import { useAuth } from "@/lib/auth/auth_context";
import { registerSchema, type RegisterInput } from "@/lib/schemas/forms";
import { MH_HOSTELS, LH_HOSTELS } from "@/lib/api/types";

const STEPS = [
  { label: "Identity" },
  { label: "Hostel group" },
  { label: "Hostel & room" },
  { label: "Payout" },
] as const;

function RegisterBand() {
  return (
    <div className="relative overflow-hidden bg-red-bauhaus text-white lg:w-1/2">
      <MotifScatter variant="hero" className="hidden lg:block" />
      <div className="relative mx-auto flex max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 lg:h-full lg:min-h-[calc(100vh-8rem)] lg:px-8">
        {/* Small-screen motif: the old floating triangle, now on-theme. */}
        <MotifScatter variant="chat" className="lg:hidden" />
        <p className="text-xs font-bold uppercase tracking-widest text-white/80">Join the marketplace</p>
        <h1 className="mt-4 max-w-md text-4xl font-black uppercase leading-[0.9] tracking-tighter sm:text-6xl">
          Residents
          <br />
          only.
        </h1>
        <p className="mt-6 max-w-sm font-medium leading-relaxed text-white/90">
          Your college email and hostel are your credentials. MH and LH are two
          separate markets — you only ever trade inside your own hostel.
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerAccount } = useAuth();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState(0);
  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
  });

  const stepFields: (keyof RegisterInput)[][] = [
    ["fullName", "email", "password", "confirmPassword"],
    ["hostelGroup"],
    ["hostelBlock", "roomNumber"],
    ["terms"],
  ];

  const nextStep = async () => {
    const valid = await trigger(stepFields[step]);
    if (valid) setStep((s) => Math.min(s + 1, 3));
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await registerAccount({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        hostelGroup: values.hostelGroup,
        hostelBlock: values.hostelBlock,
        roomNumber: values.roomNumber,
      });
      router.push("/login?registered=1");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "REGISTRATION FAILED — TRY AGAIN");
    }
  });

  return (
    <main id="main">
      <div className="flex flex-col lg:flex-row">
        <RegisterBand />
        <div className="flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:w-1/2 lg:py-24">
          <div className="w-full max-w-md">
            <Card className="relative shadow-xl">
              <CardHeader>
                <CardTitle>Create account</CardTitle>
                <p className="mt-1 text-sm font-medium text-foreground/70">
                  Already registered?{" "}
                  <Link href="/login" className="font-bold uppercase tracking-wide underline decoration-2 underline-offset-4 hover:text-red-bauhaus">
                    Log in
                  </Link>
                </p>
                <div className="mt-4">
                  <Stepper steps={STEPS.map((s, i) => ({ label: s.label, state: i < step ? "completed" : i === step ? "current" : "upcoming" }))} />
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
                  {step === 0 ? (
                    <>
                      <Input label="Full name" autoComplete="name" {...register("fullName")} />
                      {errors.fullName ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.fullName.message}</p> : null}
                      <Input label="College email" type="email" autoComplete="email" placeholder="you@vitapstudent.ac.in" {...register("email")} />
                      {errors.email ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.email.message}</p> : null}
                      <Input label="Password" type="password" autoComplete="new-password" hint="8+ chars with a letter, a number and a symbol" {...register("password")} />
                      {errors.password ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.password.message}</p> : null}
                      <Input label="Confirm password" type="password" autoComplete="new-password" {...register("confirmPassword")} />
                      {errors.confirmPassword ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.confirmPassword.message}</p> : null}
                    </>
                  ) : null}

                  {step === 1 ? (
                    <>
                      <p className="text-sm font-medium text-foreground/70">
                        Pick the side you live on. Men's hostel (MH) residents and ladies' hostel (LH) residents are two separate markets.
                      </p>
                      <Select label="Hostel group" defaultValue="" {...register("hostelGroup")}>
                        <option value="" disabled>
                          Select your hostel group
                        </option>
                        <option value="MH">Men's hostel (MH-1 … MH-7)</option>
                        <option value="LH">Ladies' hostel (LH-1 … LH-3)</option>
                      </Select>
                      {errors.hostelGroup ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.hostelGroup.message}</p> : null}
                    </>
                  ) : null}

                  {step === 2 ? (
                    <>
                      <Select label="Hostel" defaultValue="" {...register("hostelBlock")}>
                        <option value="" disabled>
                          Select your hostel
                        </option>
                        <optgroup label="Men's hostels (MH)">
                          {MH_HOSTELS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Ladies' hostels (LH)">
                          {LH_HOSTELS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </optgroup>
                      </Select>
                      {errors.hostelBlock ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.hostelBlock.message}</p> : null}
                      <Input label="Room number" placeholder="e.g. B-214" {...register("roomNumber")} />
                      {errors.roomNumber ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.roomNumber.message}</p> : null}
                    </>
                  ) : null}

                  {step === 3 ? (
                    <>
                      <p className="text-xs font-medium text-foreground/70">
                        Payout details (UPI VPA) can be added later from your account settings, when you make your first sale.
                      </p>
                      <Checkbox label="I accept the marketplace terms and the escrow policy" {...register("terms")} />
                      {errors.terms ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.terms.message}</p> : null}
                    </>
                  ) : null}

                  {serverError ? (
                    <p role="alert" className="border-2 border-black bg-red-bauhaus px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
                      {serverError}
                    </p>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between gap-4">
                    {step > 0 ? (
                      <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
                        Back
                      </Button>
                    ) : (
                      <span />
                    )}
                    {step < 3 ? (
                      <Button type="button" variant="secondary" onClick={() => void nextStep()} rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
                        Continue
                      </Button>
                    ) : (
                      <Button type="submit" variant="primary" loading={isSubmitting} leftIcon={<UserPlus className="h-5 w-5" aria-hidden="true" />}>
                        Create account
                      </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <div className="border-t-4 border-black bg-blue-bauhaus text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          <p className="text-xs font-bold uppercase tracking-widest">
            After registering, log in with your college email — straight in, no OTP.
          </p>
        </div>
      </div>
    </main>
  );
}
