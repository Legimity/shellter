import { expect, test } from "vitest";
import { bootstrapToken, initialLanguage, notice } from "../web/i18n";

test("first use follows the primary browser language and a valid saved choice wins", () => {
  expect(initialLanguage(undefined, ["zh-TW", "en"])).toBe("zh-CN");
  expect(initialLanguage(undefined, ["fr", "zh-CN"])).toBe("en");
  expect(initialLanguage({ getItem: () => "en" }, ["zh-CN"])).toBe("en");
  expect(initialLanguage({ getItem: () => "unknown" }, ["en"])).toBe("en");
});

test("blocked browser storage does not prevent starting a session", () => {
  expect(
    initialLanguage(
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      ["zh-CN"],
    ),
  ).toBe("zh-CN");
});

test("localized diagnostics retain the safety boundary and original Chinese detail", () => {
  expect(notice("extension-review", "en", "原始诊断")).toContain(
    "Review frontmatter",
  );
  expect(notice("extension-review", "zh-CN", "原始诊断")).toBe("原始诊断");
  expect(notice("new-code", "en", "原始诊断")).toContain("diagnostic details");
});

test("Chinese session and locally generated input errors explain recovery", () => {
  expect(notice("invalid-session", "zh-CN", "")).toContain("重启服务");
  expect(
    notice("invalid-input", "zh-CN", "English technical detail"),
  ).toContain("输入格式");
  expect(notice("operation-failed", "zh-CN", "Network error")).toContain(
    "连接",
  );
});

test("section navigation preserves authenticated refresh instead of consuming an entrance", () => {
  expect(bootstrapToken("#preview")).toBe("");
  expect(bootstrapToken("#source")).toBe("");
  expect(bootstrapToken("#" + "a".repeat(64))).toBe("a".repeat(64));
});
