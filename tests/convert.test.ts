import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { isJpeg, toInstagramJpeg } from "@/server/publishing/convert";

describe("Instagram JPEG conversion", () => {
  it("turns a transparent PNG into a JPEG on white, capped at 1440 px wide", async () => {
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const jpeg = await toInstagramJpeg(new Blob([new Uint8Array(png)], { type: "image/png" }));
    expect(jpeg.type).toBe("image/jpeg");
    const out = Buffer.from(await jpeg.arrayBuffer());
    expect([out[0], out[1]]).toEqual([0xff, 0xd8]); // JPEG signature
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1440);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240); // transparent pixels became white, not black
  });

  it("recognises JPEG types", () => {
    expect(isJpeg("image/jpeg")).toBe(true);
    expect(isJpeg("image/png")).toBe(false);
  });
});
