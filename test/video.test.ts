import { describe, it, expect } from "vitest";
import { youTubeId, fetchYouTubeTranscript } from "@engine/fetch/video";

describe("video transcript", () => {
  it("extracts YouTube ids from the common URL shapes", () => {
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://www.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
    expect(youTubeId("https://vimeo.com/123")).toBeUndefined();
  });
  it("prefers a human English track and flattens timed text", async () => {
    const watch = `<html><title>Talk - YouTube</title>"captionTracks":[{"baseUrl":"https://yt.test/asr","languageCode":"en","kind":"asr"},{"baseUrl":"https://yt.test/en\\u0026x=1","languageCode":"en"}]</html>`;
    const fetch = async (url: string) => {
      if (url.startsWith("https://www.youtube.com/watch")) return new Response(watch);
      if (url === "https://yt.test/en&x=1") return new Response(`<transcript><text start="0">Hello &amp; welcome</text><text start="1">to the show</text></transcript>`);
      return new Response("", { status: 404 });
    };
    const t = await fetchYouTubeTranscript("https://youtu.be/dQw4w9WgXcQ", fetch);
    expect(t).toMatchObject({ text: "Hello & welcome to the show", language: "en", title: "Talk" });
  });
  it("reports missing captions honestly", async () => {
    const t = await fetchYouTubeTranscript("https://youtu.be/dQw4w9WgXcQ", async () => new Response("<html></html>"));
    expect(t).toEqual({ error: "This video has no caption track." });
  });
});
