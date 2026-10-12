"use client";

import * as React from "react";
import { Upload, X } from "lucide-react";
import { uploadToCloudinary, cloudinaryThumb, cloudinaryConfigured } from "@/lib/cloudinary";

const MAX_IMAGES = 6;
const MAX_FILE_MB = 8;

export function UploadZone({ onUploaded }: { onUploaded: (urls: string[]) => void }) {
  const [uploading, setUploading] = React.useState<{ name: string; pct: number }[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const configured = cloudinaryConfigured();

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = MAX_IMAGES;
    const list = Array.from(files).slice(0, room);
    setUploading(list.map((f) => ({ name: f.name, pct: 0 })));
    const urls: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setUploading((u) => u.filter((_, xi) => xi !== i));
        setError(`"${file.name}" EXCEEDS ${MAX_FILE_MB}MB`);
        continue;
      }
      try {
        const res = await uploadToCloudinary(file, (pct) =>
          setUploading((u) => u.map((x, xi) => (xi === i ? { ...x, pct } : x))),
        );
        urls.push(res.secureUrl);
      } catch (err) {
        setUploading((u) => u.filter((_, xi) => xi !== i));
        setError(err instanceof Error ? err.message : "UPLOAD FAILED");
      }
    }
    setUploading([]);
    if (urls.length > 0) onUploaded(urls);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload images"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 border-4 border-dashed bg-white p-6 text-center transition-colors duration-200 ${
          configured ? "border-black hover:bg-yellow-soft" : "border-red-bauhaus"
        }`}
      >
        <Upload className="h-8 w-8" strokeWidth={3} aria-hidden="true" />
        <p className="text-sm font-bold uppercase tracking-widest">Drag photos here or browse</p>
        <p className="text-xs font-medium text-foreground/70">
          Up to {MAX_IMAGES} images · JPG/PNG/WebP · max {MAX_FILE_MB}MB each
        </p>
        {!configured ? (
          <p role="alert" className="mt-1 text-xs font-bold uppercase text-red-bauhaus">
            Cloudinary env vars not set — uploads disabled
          </p>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {error ? (
        <p role="alert" className="mt-2 text-xs font-bold uppercase text-red-bauhaus">{error}</p>
      ) : null}
      {uploading.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {uploading.map((u) => (
            <div key={u.name} className="flex items-center gap-3">
              <span className="w-40 truncate text-xs font-bold uppercase tracking-wide">{u.name}</span>
              <div className="h-4 flex-1 border-2 border-black bg-white">
                <div className="h-full bg-blue-bauhaus transition-all duration-200" style={{ width: `${u.pct}%` }} />
              </div>
              <span className="w-10 text-right text-xs font-black tabular-nums">{u.pct}%</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ImageGrid({
  images,
  setImages,
}: {
  images: string[];
  setImages: (urls: string[]) => void;
}) {
  if (images.length === 0) return null;
  const remove = (i: number) => setImages(images.filter((_, xi) => xi !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    setImages(next);
  };
  return (
    <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
      {images.map((src, i) => (
        <div key={src + i} className="relative border-2 border-black bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cloudinaryThumb(src, 320)} alt="" className="aspect-square w-full object-cover" />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Remove image ${i + 1}`}
            className="press absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center border-2 border-black bg-red-bauhaus text-white shadow-sm"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span className="absolute bottom-1 right-1 flex gap-0.5">
            <button type="button" onClick={() => move(i, -1)} aria-label="Move earlier" className="press flex h-5 w-5 items-center justify-center border-2 border-black bg-white text-[10px] font-black">
              ←
            </button>
            <button type="button" onClick={() => move(i, 1)} aria-label="Move later" className="press flex h-5 w-5 items-center justify-center border-2 border-black bg-white text-[10px] font-black">
              →
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
