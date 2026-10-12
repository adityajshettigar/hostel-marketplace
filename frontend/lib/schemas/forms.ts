import { z } from "zod";
import { LISTING_CATEGORIES, LISTING_CONDITIONS, MH_HOSTELS, LH_HOSTELS } from "@/lib/api/types";


/** College-domain rule kept configurable in one place (mirrors COLLEGE_EMAIL_DOMAINS). */
export const COLLEGE_EMAIL_SUFFIX = "@vitapstudent.ac.in";

export const collegeEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email")
  .refine((v) => v.endsWith(COLLEGE_EMAIL_SUFFIX), "Use your college email address");

export const loginSchema = z.object({
  email: collegeEmail,
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** The hostel the resident actually lives in — one of the real MH-/LH- blocks. */
export const HOSTEL_BLOCKS = [...MH_HOSTELS, ...LH_HOSTELS] as const;
export type HostelBlock = (typeof HOSTEL_BLOCKS)[number];

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name is required").max(120, "Name is too long"),
    email: collegeEmail,
    password: z
      .string()
      .min(8, "At least 8 characters")
      .max(128, "Password is too long")
      .regex(/[A-Za-z]/, "Must contain a letter")
      .regex(/[0-9]/, "Must contain a number")
      .regex(/[^A-Za-z0-9]/, "Must contain a symbol"),
    confirmPassword: z.string(),
    hostelGroup: z.enum(["MH", "LH"], { message: "Select your hostel group" }),
    hostelBlock: z.enum(HOSTEL_BLOCKS, { message: "Select your hostel" }),
    roomNumber: z
      .string()
      .trim()
      .min(1, "Room number is required")
      .max(16, "Room number is too long"),
    terms: z.literal(true, { message: "You must accept the terms" }),
  })
  .refine(
    (d) => {
      const block = d.hostelBlock.toUpperCase();
      if (d.hostelGroup === "LH") return block.startsWith("LH");
      return !block.startsWith("LH");
    },
    {
      message: "The selected hostel must match the chosen hostel group",
      path: ["hostelBlock"],
    },
  )
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const listingFormSchema = z.object({
  title: z.string().trim().min(3, "At least 3 characters").max(140, "Max 140 characters"),
  description: z.string().trim().max(4000, "Max 4000 characters").optional(),
  category: z.enum(LISTING_CATEGORIES, { message: "Pick a category" }),
  condition: z.enum(LISTING_CONDITIONS, { message: "Pick a condition" }),
  price: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Rupees, e.g. 850 or 850.00"),
  quantity: z
    .string()
    .regex(/^\d+$/, "Enter a number")
    .refine((v) => Number(v) >= 1, "At least 1")
    .refine((v) => Number(v) <= 999, "Max 999"),
  images: z.array(z.string().url()).max(6, "At most 6 images"),
});
export type ListingFormInput = z.infer<typeof listingFormSchema>;

export const offerFormSchema = z.object({
  amount: z
    .string()
    .regex(/^\d*\.?\d+$/, "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Enter an amount above zero"),
  message: z.string().trim().max(300, "Max 300 characters").optional(),
});
export type OfferFormInput = z.infer<typeof offerFormSchema>;

export const messageFormSchema = z.object({
  body: z.string().trim().min(1, "Type a message").max(2000, "Max 2000 characters"),
});
export type MessageFormInput = z.infer<typeof messageFormSchema>;

/** Backend PIN is 4 digits (generatePin: /^\d{4}$/). */
export const pinFormSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "Enter the 4-digit PIN"),
});
export type PinFormInput = z.infer<typeof pinFormSchema>;

/**
 * Dispute body per transaction-service disputeCreateSchema:
 * { reason: string(min 3, max 2000), evidenceUrls: url[1..10] } — strict.
 * Description text is carried in `reason` (the backend's only free-text field).
 */
export const DISPUTE_REASONS = [
  "ITEM_NOT_AS_DESCRIBED",
  "ITEM_NOT_RECEIVED",
  "PAYMENT_NOT_RELEASED",
  "OTHER",
] as const;

export const disputeFormSchema = z.object({
  reason: z.enum(DISPUTE_REASONS, { message: "Pick a reason" }),
  description: z
    .string()
    .trim()
    .min(30, "Describe it in at least 30 characters")
    .max(1900, "Max 1900 characters"),
  evidence: z.array(z.string().url()).min(1, "Add at least one photo or file").max(5, "At most 5 files"),
});
export type DisputeFormInput = z.infer<typeof disputeFormSchema>;

export const freezeReasonSchema = z.object({
  reason: z.string().trim().min(20, "Give a reason of at least 20 characters"),
  confirmation: z.string().min(1, "Type the confirmation phrase"),
});
export type FreezeReasonInput = z.infer<typeof freezeReasonSchema>;

/** Admin dispute resolution — disputeResolveSchema { resolution, note, secondAdminToken? }. */
export const resolveDisputeFormSchema = z.object({
  resolution: z.enum(["COMPLETED", "REFUNDED"], { message: "Pick a resolution" }),
  note: z.string().trim().min(3, "Add a short note (at least 3 characters)").max(2000),
  secondAdminToken: z.string().trim().optional(),
});
export type ResolveDisputeFormInput = z.infer<typeof resolveDisputeFormSchema>;

/** ai-service suggestListingSchema: { imageUrl (required url), category?, condition? } strict. */
export const aiListingSuggestSchema = z.object({
  imageUrl: z.string().url("Upload an image first"),
  category: z.enum(LISTING_CATEGORIES).optional(),
  condition: z.enum(LISTING_CONDITIONS).optional(),
});

/** ai-service suggestPriceSchema: { category (required), condition? } strict. */
export const aiPriceSuggestSchema = z.object({
  category: z.enum(LISTING_CATEGORIES),
  condition: z.enum(LISTING_CONDITIONS).optional(),
});

/** Counter-offer body per offerCounterSchema { offeredPrice, quantity } strict. */
export const counterOfferFormSchema = z.object({
  amount: z
    .string()
    .regex(/^\d*\.?\d+$/, "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Enter an amount above zero"),
  quantity: z
    .string()
    .regex(/^\d+$/, "Enter a number")
    .refine((v) => Number(v) >= 1, "At least 1"),
});
export type CounterOfferFormInput = z.infer<typeof counterOfferFormSchema>;
