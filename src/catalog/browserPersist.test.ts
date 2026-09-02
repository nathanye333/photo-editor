import { describe, expect, it, beforeEach, beforeAll, afterAll } from "vitest";
import { DEFAULT_LIBRARY_FILTERS } from "./filter";
import { emptyPhoto } from "./store";
import { loadBrowserCatalog, saveBrowserCatalog, stripSessionUrls } from "./browserPersist";

const KEY = "field.catalog.v1";

function mockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
}

describe("browserPersist", () => {
  const previous = globalThis.localStorage;

  beforeAll(() => {
    Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage(), configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true });
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it("strips blob URLs before saving", () => {
    const photo = {
      ...emptyPhoto({ id: "a", path: "a.jpg" }),
      blobUrl: "blob:http://localhost/abc",
      thumbDataUrl: "data:image/jpeg;base64,abc",
    };
    saveBrowserCatalog({
      photos: [photo],
      presets: [],
      snapshots: [],
      collections: [],
      collectionPhotos: [],
    });
    const loaded = loadBrowserCatalog();
    expect(loaded?.photos[0].blobUrl).toBeUndefined();
    expect(loaded?.photos[0].thumbDataUrl).toBe("data:image/jpeg;base64,abc");
    expect(stripSessionUrls(photo).blobUrl).toBeUndefined();
  });

  it("round-trips collections and collection members", () => {
    saveBrowserCatalog({
      photos: [],
      presets: [],
      snapshots: [],
      collections: [
        { id: "c1", name: "Favorites", kind: "smart", rules: { ...DEFAULT_LIBRARY_FILTERS, text: "sunset" } },
      ],
      collectionPhotos: [{ collectionId: "c1", photoId: "p1" }],
    });
    const loaded = loadBrowserCatalog();
    expect(loaded?.collections[0].name).toBe("Favorites");
    expect(loaded?.collectionPhotos).toEqual([{ collectionId: "c1", photoId: "p1" }]);
    expect(localStorage.getItem(KEY)).toContain("Favorites");
  });
});
