import { describe, expect, it } from "vitest";
import { DEFAULT_LIBRARY_FILTERS, filterPhotos, sortPhotos } from "./filter";
import { emptyPhoto } from "./store";

describe("filterPhotos", () => {
  const base = emptyPhoto({ id: "a", path: "/photos/a.jpg" });
  const photos = [
    { ...base, id: "a", rating: 3, flag: "pick" as const, exif: { Model: "Canon R5", LensModel: "RF 50mm" }, keywords: ["portrait"] },
    { ...base, id: "b", rating: 1, flag: "unflagged" as const, exif: { Model: "Sony A7", LensModel: "FE 35mm" }, keywords: ["landscape"] },
  ];

  it("filters by minimum rating", () => {
    const out = filterPhotos(photos, { ...DEFAULT_LIBRARY_FILTERS, minRating: 2 });
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });

  it("filters by camera and keyword search", () => {
    const out = filterPhotos(photos, { ...DEFAULT_LIBRARY_FILTERS, camera: "sony", text: "landscape" });
    expect(out.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("sortPhotos", () => {
  it("sorts by rating descending", () => {
    const a = emptyPhoto({ id: "a", path: "/a.jpg", rating: 1 });
    const b = emptyPhoto({ id: "b", path: "/b.jpg", rating: 5 });
    expect(sortPhotos([a, b], "rating").map((p) => p.id)).toEqual(["b", "a"]);
  });
});
