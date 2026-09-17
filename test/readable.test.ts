import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { PageFetcher, extractReadable, stripHtml } from "@engine/fetch/readable";

const parseHtml = (html: string, url: string) => {
  const { document } = parseHTML(html);
  Object.defineProperty(document, "baseURI", { value: url });
  return document as unknown as Document;
};

const ARTICLE = `<html><head><title>Bridge opens</title></head><body>
<nav>Home | About</nav>
<article><h1>Bridge opens</h1>
${Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i}: The new bridge opened on Tuesday after three years of construction, according to the city council. Officials said the span cost 40 million dollars.</p>`).join("\n")}
</article><footer>Copyright</footer></body></html>`;

function mockFetch(routes: Record<string, { status?: number; body: string; type?: string }>) {
  return async (url: string): Promise<Response> => {
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    return new Response(r.body, { status: r.status ?? 200, headers: { "content-type": r.type ?? "text/html" } });
  };
}

describe("readable extraction", () => {
  it("extracts article text and title", () => {
    const r = extractReadable(ARTICLE, "https://x.test/a", parseHtml);
    expect(r.title).toContain("Bridge opens");
    expect(r.text).toContain("three years of construction");
    expect(r.text).not.toContain("Home | About");
  });
  it("stripHtml drops scripts and nav", () => {
    expect(stripHtml("<nav>x</nav><script>1</script><p>keep &amp; this</p>")).toContain("keep & this");
    expect(stripHtml("<nav>x</nav><script>1</script><p>keep</p>")).not.toContain("x");
  });
});

describe("PageFetcher", () => {
  it("reports paywalled, failed, and ok pages honestly and caches", async () => {
    const calls: string[] = [];
    const f = mockFetch({
      "https://x.test/ok": { body: ARTICLE },
      "https://x.test/paywall": { status: 403, body: "" },
      "https://x.test/soft-paywall": { body: "<html><body><p>Subscribe to continue reading this article.</p></body></html>" },
      "https://x.test/pdf": { body: "%PDF", type: "application/pdf" },
    });
    const fetcher = new PageFetcher({
      fetch: async (u, i) => {
        calls.push(u);
        return f(u);
      },
      parseHtml,
    });
    expect((await fetcher.fetchPage("https://x.test/ok")).status).toBe("ok");
    expect((await fetcher.fetchPage("https://x.test/paywall")).status).toBe("paywalled");
    expect((await fetcher.fetchPage("https://x.test/soft-paywall")).status).toBe("paywalled");
    expect((await fetcher.fetchPage("https://x.test/pdf")).status).toBe("failed");
    expect((await fetcher.fetchPage("https://x.test/missing")).status).toBe("failed");
    await fetcher.fetchPage("https://x.test/ok");
    expect(calls.filter((c) => c.endsWith("/ok")).length).toBe(1);
  });
});
