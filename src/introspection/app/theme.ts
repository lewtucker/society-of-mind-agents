/**
 * SVG color constants — mirrors the CSS variables in globals.css.
 *
 * SVG elements inside <svg> cannot use CSS classes for fill/stroke, so we
 * keep a JS-side copy of the palette here.  To retheme the app, update the
 * :root variables in globals.css AND the matching constants below.
 */

export const KLINE_FILL: Record<string, string> = {
  positive:   "#f0fdf4",
  censor:     "#fff1f2",
  suppressor: "#fff7ed",
  abstract:   "#faf5ff",
};

export const KLINE_STROKE: Record<string, string> = {
  positive:   "#16a34a",
  censor:     "#dc2626",
  suppressor: "#ea580c",
  abstract:   "#9333ea",
};

export const BAND_STROKE: Record<string, string> = {
  core:       "#15803d",
  peripheral: "#0e7490",
  fringe:     "#374151",
};
export const BAND_WIDTH: Record<string, number> = { core: 2.5, peripheral: 1.5, fringe: 0.8 };
export const BAND_DASH:  Record<string, string> = { core: "none", peripheral: "none", fringe: "4 3" };

export const AGENT_FILL_ACTIVE    = "#dcfce7";
export const AGENT_FILL_DORMANT   = "#f9fafb";
export const AGENT_STROKE_ACTIVE  = "#16a34a";
export const AGENT_STROKE_DORMANT = "#131314";

export const COLOR_TEXT_PRIMARY = "#070707";
