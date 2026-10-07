export type Language = "en" | "zh-CN";
export function initialLanguage(
  storage?: Pick<Storage, "getItem">,
  languages: readonly string[] = [],
): Language {
  try {
    const saved = storage?.getItem("shellter.language");
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    /* Browser storage may be unavailable. */
  }
  return languages[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
export function rememberLanguage(language: Language) {
  try {
    localStorage.setItem("shellter.language", language);
  } catch {
    /* Session-only choice remains usable. */
  }
}
export function notice(
  code: string,
  language: Language,
  original: string,
): string {
  if (language === "zh-CN") {
    const localErrors: Record<string, string> = {
      "invalid-session":
        "入口已使用或会话无效；请重启服务并打开终端输出的最新链接。",
      "invalid-input":
        "请检查输入格式、必填项和路径；项目映射为 work=绝对路径，一行一个。",
      "operation-failed": "操作失败，请检查连接、配置、路径或权限后重试。",
      busy: "操作正在执行，请稍后重试。",
    };
    return localErrors[code] ?? (original || "请检查诊断详情后再继续。");
  }
  const messages: Record<string, string> = {
    "native-unverified":
      "This scan checks local configuration only. Confirm loading, execution and authentication in the target client.",
    "excluded-review":
      "Some content was excluded and requires review. Inspect the diagnostic details before using this resource.",
    "excluded-secret":
      "Sensitive content was excluded. Use credential references instead of secret values.",
    "invalid-config":
      "A configuration could not be parsed. Check the original file and diagnostic details.",

    "extension-review":
      "Skill text is preserved. Review frontmatter, tools and permissions for the target client.",
    "dependency-review":
      "Review fixed dependency versions and bind local executable paths. Applying configuration does not install or authenticate.",
    conflict:
      "The target differs from the managed source. Keep it, or explicitly enable overwrite after review. For deletion, adopt and review the current target first.",
    "duplicate-target":
      "Multiple resources write to the same target. Select one source.",
    "unsupported-or-unmapped":
      "Check client support, permissions and project/path mappings. Review the original diagnostic below.",
    unsupported:
      "This operation or resource mapping is unsupported. Cross-client instructions and file-resource deletion require manual handling.",
    "unsafe-path":
      "The resource path cannot be read safely. Check directory ownership, permissions and symlinks.",
    secret:
      "Remove sensitive values and use credential references before adopting or exporting.",
    "review-required":
      "Review unsupported fields or path arguments before continuing.",
    "invalid-session":
      "Session entrance is invalid or already used. Restart the service and open its newest link.",
    busy: "Another operation is running. Wait and try again.",
    drift:
      "Files changed since review. Inspect later edits and generate a new plan.",
    locked: "A writer holds a lock. Check the operation owner before recovery.",
    "invalid-input": "Check the input format, required fields and paths.",
  };
  return (
    messages[code] ??
    "Inspect the diagnostic details before continuing. Check configuration, paths and permissions."
  );
}

// Section anchors must not be mistaken for a one-use session entrance on reload.
export function bootstrapToken(hash: string): string {
  const value = hash.replace(/^#/, "");
  return /^[a-f0-9]{64}$/.test(value) ? value : "";
}
