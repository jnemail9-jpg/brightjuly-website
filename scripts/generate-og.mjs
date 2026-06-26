// Generates the social share image at public/og-image.jpg (1200×630) from the hero photo
// with a brand gradient scrim + wordmark. Run: `bun scripts/generate-og.mjs`.
//
// Note: SVG text is rasterized at build time using fonts available to the renderer
// (Georgia is used as the serif wordmark stand-in for DM Serif Display, which is not a
// system font). The text is baked into the JPG, so it renders identically everywhere.
import sharp from "sharp";

const W = 1200;
const H = 630;
const hero = "src/assets/hero-family.png";
const out = "public/og-image.jpg";

const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(20,16,12,0.10)" />
      <stop offset="48%" stop-color="rgba(20,16,12,0.30)" />
      <stop offset="100%" stop-color="rgba(20,16,12,0.82)" />
    </linearGradient>
    <linearGradient id="left" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgba(20,16,12,0.55)" />
      <stop offset="60%" stop-color="rgba(20,16,12,0)" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#scrim)" />
  <rect width="${W}" height="${H}" fill="url(#left)" />
  <g font-family="Georgia, 'Times New Roman', serif">
    <text x="72" y="436" fill="#FBE6C8" font-family="'Helvetica Neue', Arial, sans-serif"
          font-size="22" font-weight="700" letter-spacing="6">A NATIONAL FAMILY MOVEMENT · JULY 2026</text>
    <text x="68" y="528" fill="#ffffff" font-size="116" font-weight="400" letter-spacing="-1">Bright July</text>
    <text x="72" y="582" fill="rgba(255,255,255,0.92)" font-family="'Helvetica Neue', Arial, sans-serif"
          font-size="32" font-weight="500">This July belongs outside.</text>
  </g>
</svg>`;

await sharp(hero)
  .resize(W, H, { fit: "cover", position: "attention" })
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(out);

console.log(`Wrote ${out} (${W}x${H})`);
