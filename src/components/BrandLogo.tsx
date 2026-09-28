import { cn } from "@/lib/utils";

/**
 * Brand mark for the Groww Tech ecosystem.
 *
 * The asset path lives here and nowhere else, so re-pointing the logo (or
 * copying this file into the Result Hub app, which shares the same mark) never
 * requires touching a call site.
 */
export const BRAND_LOGO_SRC = "/assets/logo.png";

/**
 * Intrinsic size of the asset, so the browser reserves the right box up front
 * and the wordmark cannot reflow the header as it decodes.
 */
const INTRINSIC_WIDTH = 2005;
const INTRINSIC_HEIGHT = 421;

/**
 * The mark is a wide wordmark (4.76:1), so height alone drives the rendered
 * width (h-8 -> ~152px wide, h-12 -> ~228px, h-16 -> ~305px). Widths are left
 * to the aspect ratio so a future swap to a differently-proportioned asset does
 * not squash the mark.
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
