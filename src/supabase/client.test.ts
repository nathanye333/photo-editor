import { describe, expect, it } from "vitest";
import { isSupabaseConfigured } from "../supabase/client";

describe("supabase client", () => {
  it("reports unconfigured when Vite env keys are missing", () => {
    expect(isSupabaseConfigured()).toBe(false);
  });
});
