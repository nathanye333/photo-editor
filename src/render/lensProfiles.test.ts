import { describe, expect, it } from "vitest";
import { lensProfile, matchLensProfile } from "./lensProfiles";

describe("matchLensProfile", () => {
  it("prefers a lens name over the focal length bucket", () => {
    const match = matchLensProfile({
      Make: "Canon",
      LensModel: "RF 70-200mm F2.8 L IS USM",
      FocalLength: "35mm",
    });
    expect(match?.id).toBe("telephoto");
  });

  it("falls back to the focal length bucket", () => {
    expect(matchLensProfile({ FocalLength: "16mm" })?.id).toBe("ultrawide");
    expect(matchLensProfile({ FocalLength: "50mm" })?.id).toBe("standard-prime");
    expect(matchLensProfile({ FocalLength: "300mm" })?.id).toBe("telephoto");
  });

  it("matches phones by camera model", () => {
    expect(matchLensProfile({ Model: "iPhone 15 Pro" })?.id).toBe("phone");
  });

  it("returns null without usable metadata", () => {
    expect(matchLensProfile({})).toBeNull();
    expect(matchLensProfile({ Model: "Unknown Cam" })).toBeNull();
  });
});

describe("lensProfile", () => {
  it("resolves by id and ignores unknown ids", () => {
    expect(lensProfile("wide-zoom")?.name).toContain("wide zoom");
    expect(lensProfile("")).toBeNull();
    expect(lensProfile("nope")).toBeNull();
  });
});
