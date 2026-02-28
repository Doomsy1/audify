import { getClip } from "../lib/audio/clipStore.server.js";

export function createClipLoader({ loadClip }) {
  return async ({ params }) => {
    const clip = loadClip(params.clipId);
    if (!clip) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(clip.body, {
      headers: {
        "Content-Type": clip.contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  };
}

export const loader = createClipLoader({
  loadClip: getClip,
});
