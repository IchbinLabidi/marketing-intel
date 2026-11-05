"use client";

import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality } from "mediabunny";
import { MAX_FILE_BYTES } from "@/lib/publishing/rules";

/** Leave room under the storage limit for container overhead and bitrate overshoot. */
const TARGET_BYTES = Math.floor(MAX_FILE_BYTES * 0.92);
const AUDIO_BPS = 128_000;
const MIN_VIDEO_BPS = 600_000; // below this a 1080p video looks bad: refuse instead
const LONG_SIDE = 1920;

export class VideoTooLongError extends Error {}
export class CompressionCanceledError extends Error {}

export const needsCompression = (file: { type: string; size: number }) => file.type.startsWith("video/") && file.size > MAX_FILE_BYTES;

/**
 * Re-encodes a video in the browser (WebCodecs, hardware H.264 where available) so it fits under the publishing
 * storage limit: same frame rate, at most 1920 px on the long side, bitrate chosen from the duration, AAC audio.
 * Nothing leaves the computer until the smaller file is ready. Resolves with an MP4 File.
 */
export async function compressVideo(file: Blob, name: string, onProgress?: (share: number) => void, onCancelable?: (cancel: () => void) => void): Promise<File> {
  let canceled = false;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const duration = await input.computeDuration();
  if (!duration || !Number.isFinite(duration)) throw new Error("Unreadable video");
  const track = await input.getPrimaryVideoTrack();
  const w = track?.displayWidth ?? 0;
  const h = track?.displayHeight ?? 0;
  const scale = Math.max(w, h) > LONG_SIDE ? LONG_SIDE / Math.max(w, h) : 1;
  const size = scale < 1 ? { width: Math.round((w * scale) / 2) * 2, height: Math.round((h * scale) / 2) * 2, fit: "contain" as const } : {};

  let videoBps = Math.floor((TARGET_BYTES * 8) / duration - AUDIO_BPS);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (videoBps < MIN_VIDEO_BPS) throw new VideoTooLongError();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input: attempt === 0 ? input : new Input({ source: new BlobSource(file), formats: ALL_FORMATS }),
      output,
      video: { codec: "avc", quality: new Quality({ bitrate: videoBps, bitrateMode: "constant" }), ...size },
      audio: { codec: "aac", quality: new Quality({ bitrate: AUDIO_BPS }) },
    });
    if (!conversion.isValid) throw new Error("This video can't be converted in this browser");
    conversion.onProgress = (p) => onProgress?.(Math.min(1, p));
    onCancelable?.(() => { canceled = true; void conversion.cancel(); });
    try {
      await conversion.execute();
    } catch (e) {
      if (canceled) throw new CompressionCanceledError();
      throw e;
    }
    if (canceled) throw new CompressionCanceledError();
    const buffer = output.target.buffer;
    if (buffer && buffer.byteLength <= MAX_FILE_BYTES) {
      return new File([buffer], name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4" });
    }
    // the encoder overshot: try again a bit lower
    videoBps = Math.floor(videoBps * 0.8);
  }
  throw new Error("The video is still too large after compression");
}
