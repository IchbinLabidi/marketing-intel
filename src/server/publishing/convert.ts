import "server-only";
import sharp from "sharp";

/**
 * Instagram's publishing API only accepts JPEG photos. Other formats (PNG, WebP, GIF first frame) are converted here:
 * transparency is flattened on white, the photo is oriented, and kept at most 1440 px wide (Instagram's maximum).
 */
export async function toInstagramJpeg(photo: Blob): Promise<Blob> {
  const input = Buffer.from(await photo.arrayBuffer());
  const out = await sharp(input, { animated: false })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 1440, withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return new Blob([new Uint8Array(out)], { type: "image/jpeg" });
}

export const isJpeg = (mime: string | null | undefined) => mime === "image/jpeg" || mime === "image/jpg";
