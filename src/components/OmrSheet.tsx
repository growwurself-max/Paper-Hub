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
    ctx.save();
    ctx.scale(PREVIEW_SCALE, PREVIEW_SCALE);
    drawOmrLayout(ctx, layout);
    ctx.restore();
  }, [signature]);

  return (
    <div className="overflow-x-auto bg-white text-black print:overflow-visible">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={props.mode === "key" ? "Bubbled OMR answer key" : "OMR answer sheet"}
        className="block h-auto w-full print:h-auto print:w-[210mm]"
      />
    </div>
  );
}
