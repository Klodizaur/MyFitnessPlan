/**
 * The YouTube mark.
 *
 * Lucide dropped its brand icons, so this is the glyph the app already used in
 * YouTubeBadge, pulled out so the redesigned screens and the old badge draw the
 * same shape. `currentColor` for the body, with the play triangle knocked out,
 * so it works on a light chip or a dark one.
 */
export default function YouTubeGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8C22 15.2 22 12 22 12s0-3.2-.4-4.8z" />
      <path d="M10 15.5v-7l6 3.5-6 3.5z" fill="#000" fillOpacity="0.75" />
    </svg>
  );
}
