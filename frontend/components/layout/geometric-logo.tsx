import { cn } from "@/lib/utils";

export function GeometricLogo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span aria-hidden="true" className="relative inline-block h-8 w-14">
        <span className="absolute left-0 top-1 h-6 w-6 rounded-full border-2 border-black bg-red-bauhaus" />
        <span className="absolute left-4 top-1 h-6 w-6 border-2 border-black bg-blue-bauhaus" />
        <span className="shape-triangle absolute left-8 top-1 h-6 w-6 bg-yellow-bauhaus" />
      </span>
      <span
        className={cn(
          "font-black uppercase tracking-tighter",
          inverted ? "text-white" : "text-foreground",
        )}
      >
        <span className="text-lg leading-none">HOSTEL</span>
        <span className="block text-sm leading-none text-red-bauhaus">MARKETPLACE</span>
      </span>
    </span>
  );
}
