import { test, expect } from "vitest";
import { hasSecret } from "../src/security";

test("empty shell arrays are not credential assignments, but nonempty values remain blocked", () => {
  expect(hasSecret("WRITTEN_SECRET=() # names only\n")).toBe(false);
  for (const value of [
    "secret=real-value",
    "WRITTEN_SECRET=(real-value)",
    "secret=()suffix",
    "api_key=sk-not-a-real-key",
    "Bearer example-token",
  ])
    expect(hasSecret(value)).toBe(true);
});
