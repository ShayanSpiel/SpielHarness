import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { lifecycleSchema, enabledSchema } from "@spielos/core";

describe("lifecycleSchema", () => {
  it("accepts 'draft'", () => {
    assert.ok(lifecycleSchema.safeParse("draft").success);
  });

  it("accepts 'published'", () => {
    assert.ok(lifecycleSchema.safeParse("published").success);
  });

  it("accepts 'archived'", () => {
    assert.ok(lifecycleSchema.safeParse("archived").success);
  });

  it("rejects unknown lifecycle values", () => {
    assert.ok(!lifecycleSchema.safeParse("deleted").success);
    assert.ok(!lifecycleSchema.safeParse("").success);
  });
});

describe("enabledSchema", () => {
  it("accepts true", () => {
    assert.ok(enabledSchema.safeParse(true).success);
  });

  it("accepts false", () => {
    assert.ok(enabledSchema.safeParse(false).success);
  });

  it("rejects non-boolean values", () => {
    assert.ok(!enabledSchema.safeParse("true").success);
    assert.ok(!enabledSchema.safeParse(1).success);
    assert.ok(!enabledSchema.safeParse(null).success);
  });
});
