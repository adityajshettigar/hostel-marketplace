import { request } from "@/lib/api/client";

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
const UNSIGNED_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? "";

export function cloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && UNSIGNED_PRESET);
}

export type CloudinaryUploadResult = { secureUrl: string; bytes: number };

/**
 * Unsigned direct-to-Cloudinary upload (brief §1/§7.4).
 * Returns the secure URL that gets persisted to marketplace-service.
 */
export function uploadToCloudinary(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    if (!cloudinaryConfigured()) {
      reject(new Error("CLOUDINARY NOT CONFIGURED — ADD THE PRESET ENV VARS"));
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", UNSIGNED_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as {
          secure_url?: string;
          bytes?: number;
          error?: { message?: string };
        };
        if (xhr.status >= 200 && xhr.status < 300 && json.secure_url) {
          resolve({ secureUrl: json.secure_url, bytes: json.bytes ?? 0 });
        } else {
          reject(new Error((json.error?.message ?? "UPLOAD FAILED").toUpperCase()));
        }
      } catch {
        reject(new Error("UPLOAD FAILED — BAD RESPONSE"));
      }
    };
    xhr.onerror = () => reject(new Error("UPLOAD FAILED — NETWORK ERROR"));
    xhr.send(form);
  });
}

/** Build a sized thumbnail URL for grids (Cloudinary transformation). */
export function cloudinaryThumb(url: string, width = 640): string {
  if (!url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
}

let razorpayPromise: Promise<boolean> | null = null;

/** Dynamically load the Razorpay Checkout script exactly once (brief §7.7). */
export function loadRazorpay(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayPromise) return razorpayPromise;
  razorpayPromise = new Promise<boolean>((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => {
      razorpayPromise = null;
      resolve(false);
    };
    document.body.appendChild(s);
  });
  return razorpayPromise;
}

/**
 * Open Razorpay Checkout for an escrow order created through the gateway.
 * Resolves with the payment id on success; rejects on failure/dismiss.
 */
export function openRazorpayCheckout(input: {
  orderId: string;
  amount: number; // rupees
  keyId: string;
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string };
}): Promise<{ razorpay_payment_id: string }> {
  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error("RAZORPAY CHECKOUT FAILED TO LOAD"));
      return;
    }
    const rzp = new window.Razorpay({
      key: input.keyId,
      order_id: input.orderId,
      amount: Math.round(input.amount * 100), // paise
      currency: "INR",
      name: input.name ?? "HOSTEL MARKETPLACE ESCROW",
      description: input.description ?? "ESCROW FUNDING",
      prefill: input.prefill,
      // Razorpay's API needs a literal hex — this IS the token value
      // --primary-blue from globals.css (Bauhaus Blue).
      theme: { color: "#1040C0" },
      modal: { ondismiss: () => reject(new Error("PAYMENT CANCELLED")) },
      handler: (r: { razorpay_payment_id: string }) => resolve(r),
    });
    rzp.on("payment.failed", () => reject(new Error("PAYMENT FAILED — TRY AGAIN")));
    rzp.open();
  });
}

/**
 * Root page fetcher for server components that need the real gateway origin
 * (server-side calls are not bound by CORS).
 */
export function gatewayOrigin(): string {
  return (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: (arg: unknown) => void) => void;
    };
  }
}

// Re-exported for convenience so pages import from one module.
export { request };
