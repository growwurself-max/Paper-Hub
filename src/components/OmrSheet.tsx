import { useEffect, useRef } from "react";
import { buildOmrLayout, drawOmrLayout, type OmrSheetProps } from "@/lib/omr-sheet";

/** Backing-store multiplier for the preview, so the sheet stays sharp on hi-dpi screens. */
const PREVIEW_SCALE = 2;

/**
 * Print-ready OMR sheet. The same painter that produces the downloadable image
 * draws the preview, so what is on screen is exactly what gets printed and
 * scanned. Nothing is injected as markup, so exam text cannot break the sheet.
 */
export function OmrSheet(props: OmrSheetProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Props arrive as a fresh object every render, so the redraw is keyed off a
  // stable signature of the fields the layout reads.
  const signature = JSON.stringify(props);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const layout = buildOmrLayout(JSON.parse(signature) as OmrSheetProps);
    canvas.width = Math.round(layout.page.width * PREVIEW_SCALE);
    canvas.height = Math.round(layout.page.height * PREVIEW_SCALE);
    // drawOmrLayout applies PREVIEW_SCALE itself; pre-scaling the context here
    // would be discarded by the painter's setTransform.
    drawOmrLayout(ctx, layout, { scale: PREVIEW_SCALE });
  }, [signature]);

  return (
    <div className="overflow-x-auto bg-white text-black print:overflow-visible omr-print-page">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={props.mode === "key" ? "Bubbled OMR answer key" : "OMR answer sheet"}
        className="omr-sheet-canvas block h-auto w-full"
      />
    </div>
  );
}
