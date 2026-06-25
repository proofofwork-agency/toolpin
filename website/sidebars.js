const sidebars = {
  docs: [
    "intro",
    {
      type: "category",
      label: "Tutorials",
      items: ["tutorials/install-first-server"],
    },
    {
      type: "category",
      label: "How-to",
      items: ["how-to/catch-drift-in-ci"],
    },
    {
      type: "category",
      label: "Reference",
      items: [
        "reference/cli",
        "reference/client-matrix",
        "reference/lockfile-schema",
        "reference/policy-schema",
      ],
    },
    {
      type: "category",
      label: "Concepts",
      items: ["concepts/trust-explained", "concepts/threat-model", "concepts/comparison"],
    },
  ],
};

module.exports = sidebars;
