/** Clerk components themed to the LendLoop design tokens. */
export const clerkAppearance = {
  options: {
    // The deployed app uses Clerk's development instance (a production instance needs an owned
    // domain). This only hides the "Development mode" label; the dev-instance limits still apply.
    unsafe_disableDevelopmentModeWarnings: true,
  },
  variables: {
    colorPrimary: "#1f1b16",
    colorPrimaryForeground: "#ffffff",
    colorForeground: "#171717",
    colorMutedForeground: "#777777",
    colorBackground: "#fffefb",
    colorInput: "#ffffff",
    colorInputForeground: "#171717",
    colorBorder: "#e7e0d3",
    colorDanger: "#a8352a",
    borderRadius: "10px",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
    fontSize: "14px",
  },
  elements: {
    card: { boxShadow: "0 1px 0 rgb(23 23 23 / 0.03), 0 10px 28px -12px rgb(23 23 23 / 0.22)", border: "1px solid #e7e0d3" },
    footer: { background: "#faf7f1" },
  },
};
