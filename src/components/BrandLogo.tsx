import { cn } from "@/lib/utils";

/**
 * Brand mark for the Groww Tech ecosystem.
 *
 * The asset path lives here and nowhere else, so re-pointing the logo (or
 * copying this file into the Result Hub app, which shares the same mark) never
 * requires touching a call site.
 */
export const BRAND_LOGO_SRC = "/assets/logo.jpeg";

/** Intrinsic size of the asset, so the browser reserves the right box up front. */
const INTRINSIC_WIDTH = 495;
const INTRINSIC_HEIGHT = 198;

/**
 * The mark is a 2.5:1 wordmark, so height alone drives the rendered width
 * (h-12 -> 120px wide, h-16 -> 160px). Anything below h-8 makes the baked-in
 * "by Groww Tech" text too small to read.
 */
const HEIGHT_CLASSES = {
  sm: "h-8",
  md: "h-12",
  lg: "h-16",
} as const;

export type BrandLogoHeight = keyof typeof HEIGHT_CLASSES;

type BrandLogoProps = {
  className?: string;
  /** Rendered height. Width follows the intrinsic aspect ratio. */
  height?: BrandLogoHeight;
  alt?: string;
};

export function BrandLogo({
  className,
  height = "md",
  alt = "Paper Hub by Groww Tech",
}: BrandLogoProps) {
  return (
    <img
      src={BRAND_LOGO_SRC}
      alt={alt}
      width={INTRINSIC_WIDTH}
      height={INTRINSIC_HEIGHT}
      // Height is fixed and width is auto so the aspect ratio is preserved, and
      // shrink-0 stops the wordmark from being squashed when a flex parent
      // reflows - e.g. while a sidebar is collapsing.
      className={cn(
        "w-auto shrink-0 object-contain object-left",
        HEIGHT_CLASSES[height],
        className,
      )}
      // The logo is the largest paint on the sign-in screen, so it should not
      // be deferred or lazily decoded.
      decoding="sync"
      fetchPriority="high"
    />
  );
}
