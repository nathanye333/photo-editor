import { describe, expect, it } from "vitest";
import { photoMatchesFilters, DEFAULT_LIBRARY_FILTERS } from "./filter";
import { emptyPhoto } from "./store";
import { assignBurstStacks, collapseStacks, stackCount } from "./stacks";

describe("assignBurstStacks", () => {
  it("groups photos captured within 2 seconds in the same folder", () => {
    const base = emptyPhoto({ id: "a", path: "/p/a.jpg", folder: "/p" });
    const existing = [
      {
        ...base,
        id: "a",
        exif: { DateTimeOriginal: "2024-01-01 12:00:00" },
      },
    ];
    const added = [
      {
        ...base,
        id: "b",
        path: "/p/b.jpg",
        exif: { DateTimeOriginal: "2024-01-01 12:00:01" },
      },
    ];
    const updates = assignBurstStacks(existing, added);
    expect(updates).toHaveLength(2);
    const stackId = updates.find((p) => p.id === "b")?.stackId;
    expect(stackId).toBeTruthy();
    expect(updates.find((p) => p.id === "a")?.stackId).toBe(stackId);
  });
});

describe("collapseStacks", () => {
  it("shows only stack cover unless expanded", () => {
    const a = emptyPhoto({ id: "a", path: "/a.jpg", stackId: "s1", stackIndex: 0 });
    const b = emptyPhoto({ id: "b", path: "/b.jpg", stackId: "s1", stackIndex: 1 });
    const c = emptyPhoto({ id: "c", path: "/c.jpg" });
    expect(collapseStacks([a, b, c], new Set()).map((p) => p.id)).toEqual(["c", "a"]);
    expect(collapseStacks([a, b, c], new Set(["s1"])).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(stackCount([a, b], "s1")).toBe(2);
  });
});

describe("photoMatchesFilters", () => {
  it("matches smart collection rules", () => {
    const photo = emptyPhoto({ id: "a", path: "/a.jpg", rating: 4, flag: "pick" });
    expect(photoMatchesFilters(photo, { ...DEFAULT_LIBRARY_FILTERS, minRating: 3, flag: "pick" })).toBe(true);
    expect(photoMatchesFilters(photo, { ...DEFAULT_LIBRARY_FILTERS, flag: "reject" })).toBe(false);
  });
});
