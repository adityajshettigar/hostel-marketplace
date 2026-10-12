import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MotifScatter } from "@/components/ui/hostel-motif";

export default function NotFound() {
  return (
    <main id="main" className="relative mx-auto flex max-w-7xl flex-col items-center px-4 py-24 text-center sm:px-6 lg:px-8">
      <MotifScatter variant="404" className="hidden md:block" />
      <p className="text-xs font-bold uppercase tracking-widest text-foreground/60">Error 404</p>
      <h1 className="mt-3 text-5xl font-black uppercase leading-[0.9] tracking-tighter sm:text-7xl">
        Lost in
        <br />
        the grid
      </h1>
      <p className="mt-4 max-w-md font-medium leading-relaxed text-foreground/80">
        This page does not exist — but the market does. Head back and keep browsing.
      </p>
      <Link href="/" className="mt-8">
        <Button variant="primary" size="lg">Back to the market</Button>
      </Link>
    </main>
  );
}
