import { MotifScatter } from "@/components/ui/hostel-motif";

export function SiteFooter() {
  return (
    <footer className="border-t-4 border-black bg-foreground text-white">
      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Footer corner motif — the documented higher-opacity exception (white 15–20% on black). */}
        <MotifScatter variant="footer" tone="white" className="hidden lg:block" />
        <p className="mx-auto mt-6 max-w-2xl text-center text-base font-black uppercase tracking-widest text-white/80">
          The Shop in need is Hostel Marketplace indeed...
        </p>
      </div>
    </footer>
  );
}
