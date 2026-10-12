"use client";

/**
 * QR scanner — BarcodeDetector when available, jsQR fallback via canvas.
 * Never a blur; the preview sits in a hard-bordered frame with corner
 * brackets as geometric decorations.
 */
import * as React from "react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";

export function QrScanner({
  onScan,
  onError,
}: {
  onScan: (text: string) => void;
  onError: (message: string) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [manual, setManual] = React.useState("");
  const [showManual, setShowManual] = React.useState(false);
  const stopped = React.useRef(false);

  React.useEffect(() => {
    stopped.current = false;
    let stream: MediaStream | null = null;
    let raf = 0;

    const tick = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || stopped.current) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = 320;
        const h = 320;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h);
          const code = jsQR(data.data, data.width, data.height);
          if (code?.data) {
            onScan(code.data);
            return;
          }
        }
      }
      if (!stopped.current) raf = requestAnimationFrame(tick);
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        void tick();
      } catch {
        onError("CAMERA UNAVAILABLE — ENTER THE CODE INSTEAD");
        setShowManual(true);
      }
    };
    void start();

    return () => {
      stopped.current = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full max-w-xs overflow-hidden border-4 border-black bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Camera preview" />
        {[
          "left-2 top-2 border-l-4 border-t-4",
          "right-2 top-2 border-r-4 border-t-4",
          "left-2 bottom-2 border-b-4 border-l-4",
          "right-2 bottom-2 border-b-4 border-r-4",
        ].map((cls) => (
          <span key={cls} aria-hidden="true" className={`absolute h-8 w-8 border-yellow-bauhaus ${cls}`} />
        ))}
        <canvas ref={canvasRef} className="hidden" />
      </div>
      <button type="button" className="text-left text-xs font-bold uppercase underline decoration-2 underline-offset-4" onClick={() => setShowManual((v) => !v)}>
        {showManual ? "Hide manual entry" : "ENTER CODE INSTEAD"}
      </button>
      {showManual ? (
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Paste the code the buyer shows you"
            aria-label="Handover code"
            className="h-11 w-full border-2 border-black bg-white px-3 shadow-sm focus:shadow-md"
          />
          <Button variant="secondary" onClick={() => manual.trim() && onScan(manual.trim())}>
            Confirm
          </Button>
        </div>
      ) : null}
    </div>
  );
}
