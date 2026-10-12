"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { MotifScatter } from "@/components/ui/hostel-motif";
import { RequireAuth } from "@/lib/auth/auth-context";
import { useCreateListing, useAiListingSuggestion, useAiPriceSuggestion } from "@/lib/api/mutations";
import { UploadZone, ImageGrid } from "@/components/listings/image-upload";
import {
  listingFormSchema,
  aiListingSuggestSchema,
  aiPriceSuggestSchema,
  type ListingFormInput,
} from "@/lib/schemas/forms";
import { LISTING_CATEGORIES, LISTING_CONDITIONS } from "@/lib/api/types";
import { formatCurrency } from "@/lib/utils";

type AiFieldState = "ai" | "edited";

/** Gated: publishing requires an authenticated, verified session. */
export default function SellNewPage() {
  return (
    <RequireAuth>
      <SellNewInner />
    </RequireAuth>
  );
}

function SellNewInner() {
  const router = useRouter();
  const createListing = useCreateListing();
  const aiListing = useAiListingSuggestion();
  const aiPrice = useAiPriceSuggestion();
  const [images, setImages] = React.useState<string[]>([]);
  const [aiFields, setAiFields] = React.useState<Record<string, AiFieldState | undefined>>({});
  const [priceRange, setPriceRange] = React.useState<{ low: number; mid: number; high: number; fallbackUsed?: boolean } | null>(null);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [serverNotice, setServerNotice] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ListingFormInput>({
    resolver: zodResolver(listingFormSchema),
    mode: "onBlur",
    defaultValues: { images: [], quantity: "1" },
  });

  const category = watch("category");
  const condition = watch("condition");

  const aiTouched = Object.entries(aiFields).filter(([, v]) => v === "ai").map(([k]) => k);

  const markAi = (field: string) => setAiFields((s) => ({ ...s, [field]: "ai" }));
  const trackEdit = (field: string) =>
    setAiFields((s) => (s[field] === "ai" ? { ...s, [field]: "edited" } : s));

  const onUploaded = (urls: string[]) => {
    setImages((prev) => {
      const next = [...prev, ...urls].slice(0, 6);
      setValue("images", next, { shouldValidate: true });
      return next;
    });
  };

  const requestListingAi = async () => {
    setAiError(null);
    const parsed = aiListingSuggestSchema.safeParse({
      imageUrl: images[0],
      category: category || undefined,
      condition: condition || undefined,
    });
    if (!parsed.success) {
      setAiError("UPLOAD AT LEAST ONE PHOTO FIRST — AI SUGGESTIONS NEED AN IMAGE");
      return;
    }
    try {
      const res = await aiListing.mutateAsync(parsed.data);
      if (res.suggestion.suggestedTitle) {
        setValue("title", res.suggestion.suggestedTitle, { shouldDirty: true });
        markAi("title");
      }
      if (res.suggestion.suggestedDescription) {
        setValue("description", res.suggestion.suggestedDescription, { shouldDirty: true });
        markAi("description");
      }
      if (res.suggestion.suggestedCategory) {
        const cat = res.suggestion.suggestedCategory.toUpperCase().replace(/[^A-Z]/g, "");
        const match = LISTING_CATEGORIES.find((c) => c.toUpperCase() === cat);
        if (match) {
          setValue("category", match, { shouldDirty: true });
          markAi("category");
        }
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI SUGGESTION FAILED");
    }
  };

  const requestPriceAi = async () => {
    setAiError(null);
    const parsed = aiPriceSuggestSchema.safeParse({
      category: category || undefined,
      condition: condition || undefined,
    });
    if (!parsed.success) {
      setAiError("PICK A CATEGORY FIRST — PRICE SUGGESTIONS ARE PER-CATEGORY");
      return;
    }
    try {
      const res = await aiPrice.mutateAsync(parsed.data);
      setPriceRange({ ...res.suggestion, fallbackUsed: res.fallbackUsed });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "PRICE SUGGESTION FAILED");
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerNotice(null);
    try {
      await createListing.mutateAsync({
        title: values.title,
        description: values.description,
        category: values.category,
        condition: values.condition,
        price: values.price,
        quantity: Number(values.quantity),
        images: values.images,
      });
      router.push("/");
    } catch (err) {
      setServerNotice(err instanceof Error ? err.message : "COULD NOT CREATE LISTING");
    }
  });

  return (
    <main id="main">
      <section aria-label="Page header" className="border-b-4 border-black bg-yellow-bauhaus">
        <div className="relative mx-auto max-w-7xl overflow-hidden px-4 py-12 sm:px-6 lg:px-8">
          <MotifScatter variant="sell" className="hidden sm:block" />
          <h1 className="text-4xl font-black uppercase leading-[0.9] tracking-tighter sm:text-5xl">List an item</h1>
          <p className="mt-3 max-w-xl font-medium leading-relaxed">
            Photos, facts, price. AI drafts the words — you keep the say.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle>Item details</CardTitle>
            {aiTouched.length > 0 ? (
              <p role="status" className="mt-3 border-2 border-black bg-yellow-soft px-3 py-2 text-xs font-bold uppercase tracking-widest">
                AI SUGGESTION — PLEASE REVIEW: {aiTouched.join(", ").toUpperCase()}
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest">Photos (first = cover)</p>
                <UploadZone onUploaded={onUploaded} />
                <ImageGrid images={images} setImages={(next) => {
                  setImages(next);
                  setValue("images", next, { shouldValidate: true });
                }} />
              </div>

              <div className="border-t-4 border-black pt-6">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-bold uppercase tracking-widest">AI assist</p>
                  {aiListing.isPending || aiPrice.isPending ? (
                    <span className="h-5 w-5 animate-spin-square border-2 border-black" aria-hidden="true" />
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button type="button" variant="outline" loading={aiListing.isPending} onClick={() => void requestListingAi()} leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
                    Get AI suggestions
                  </Button>
                  <Button type="button" variant="outline" loading={aiPrice.isPending} onClick={() => void requestPriceAi()} leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
                    Suggest a price
                  </Button>
                </div>
                {priceRange ? (
                  <p role="status" className="mt-3 border-2 border-black bg-yellow-soft px-3 py-2 text-sm font-bold tabular-nums">
                    SOLD MEDIANS: {formatCurrency(String(priceRange.low))} — {formatCurrency(String(priceRange.high))} · mid {formatCurrency(String(priceRange.mid))}
                    {priceRange.fallbackUsed ? " · FALLBACK (NO SOLD DATA)" : ""}
                  </p>
                ) : null}
                {aiError ? (
                  <p role="alert" className="mt-3 text-xs font-bold uppercase text-red-bauhaus">{aiError}</p>
                ) : null}
              </div>

              <div className="border-t-4 border-black pt-6 flex flex-col gap-4">
                <div className="flex items-end gap-2">
                  <Input label="Title" {...register("title", { onChange: () => trackEdit("title") })} />
                  {aiFields.title === "ai" ? <Badge tone="yellow" className="mb-2">AI</Badge> : null}
                  {aiFields.title === "edited" ? <Badge tone="blue" className="mb-2">EDITED</Badge> : null}
                </div>
                {errors.title ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.title.message}</p> : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Select label="Category" defaultValue="" {...register("category", { onChange: () => trackEdit("category") })}>
                      <option value="" disabled>Pick a category</option>
                      {LISTING_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </Select>
                    {aiFields.category === "ai" ? <Badge tone="yellow" className="mt-2">AI</Badge> : null}
                    {aiFields.category === "edited" ? <Badge tone="blue" className="mt-2">EDITED</Badge> : null}
                    {errors.category ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.category.message}</p> : null}
                  </div>
                  <div>
                    <Select label="Condition" defaultValue="" {...register("condition")}>
                      <option value="" disabled>Pick a condition</option>
                      {LISTING_CONDITIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </Select>
                    {errors.condition ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.condition.message}</p> : null}
                  </div>
                  <div>
                    <Input label="Price (₹)" type="number" min="1" step="1" {...register("price")} />
                    {errors.price ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.price.message}</p> : null}
                  </div>
                  <div>
                    <Input label="Quantity" type="number" min="1" step="1" {...register("quantity")} />
                    {errors.quantity ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.quantity.message}</p> : null}
                  </div>
                </div>

                <div>
                  <Textarea label="Description" rows={5} {...register("description", { onChange: () => trackEdit("description") })} />
                  <div className="mt-1 flex items-center gap-2">
                    {aiFields.description === "ai" ? <Badge tone="yellow">AI</Badge> : null}
                    {aiFields.description === "edited" ? <Badge tone="blue">EDITED</Badge> : null}
                    {errors.description ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.description.message}</p> : null}
                  </div>
                </div>
              </div>

              {serverNotice ? (
                <p role="alert" className="border-2 border-black bg-red-bauhaus px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">{serverNotice}</p>
              ) : null}

              <Button type="submit" variant="primary" size="lg" loading={isSubmitting || createListing.isPending}>
                Publish listing
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
