import { getClip } from "../lib/audio/clipStore.server";

export const loader = async ({ params }) => {
  const clip = getClip(params.clipId);
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
