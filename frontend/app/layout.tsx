import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { Providers } from "@/app/providers";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "Smart Hostel Marketplace",
  description:
    "A campus-only marketplace for hostel students — buy, sell and negotiate within your own block, paid through escrow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={outfit.variable}>
      <body>
        <Providers>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
