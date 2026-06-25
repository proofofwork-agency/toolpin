const config = {
  title: "ToolPin",
  tagline: "Trusted install, lockfiles, and governance for MCP servers.",
  url: "https://toolpin.dev",
  baseUrl: "/",
  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  organizationName: "proofofworks",
  projectName: "TPN",
  trailingSlash: false,
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          path: "../docs/site",
          routeBasePath: "docs",
          sidebarPath: "./sidebars.js",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: "ToolPin",
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
        { to: "/docs/tutorials/install-first-server", label: "Quickstart", position: "right" },
        { href: "https://github.com/proofofworks/TPN", label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Quickstart", to: "/docs/tutorials/install-first-server" },
            { label: "CLI reference", to: "/docs/reference/cli" },
            { label: "Threat model", to: "/docs/concepts/threat-model" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "GitHub", href: "https://github.com/proofofworks/TPN" },
            { label: "Security", href: "https://github.com/proofofworks/TPN/security" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ToolPin contributors.`,
    },
  },
};

module.exports = config;
