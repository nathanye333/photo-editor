import { describe, expect, it } from "vitest";
import { cloneRecipe, defaultRecipe } from "../recipe/defaults";
import { createVirtualCopy, emptyPhoto } from "./store";

describe("createVirtualCopy", () => {
  it("creates a copy sharing path and thumb with independent recipe", () => {
    const master = emptyPhoto({
      id: "master-1",
      path: "/photos/test.jpg",
      width: 1000,
      height: 800,
      thumbPath: "/thumbs/master-1.jpg",
    });
    master.recipe = cloneRecipe({ ...defaultRecipe(), globals: { ...defaultRecipe().globals, exposure: 1 } });
    const copy = createVirtualCopy(master, [master]);
    expect(copy.id).not.toBe(master.id);
    expect(copy.path).toBe(master.path);
    expect(copy.masterId).toBe(master.id);
    expect(copy.copyName).toBe("Copy 1");
    expect(copy.thumbPath).toBe(master.thumbPath);
    expect(copy.recipe.globals.exposure).toBe(1);
    expect(copy.history.present).toEqual(copy.recipe);
  });

  it("increments copy number for additional copies", () => {
    const master = emptyPhoto({ id: "m", path: "/a.jpg" });
    const first = createVirtualCopy(master, [master]);
    const second = createVirtualCopy(master, [master, first]);
    expect(second.copyName).toBe("Copy 2");
    expect(second.masterId).toBe(master.id);
  });
});
