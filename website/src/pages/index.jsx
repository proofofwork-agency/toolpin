import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";

export default function Home() {
  return (
    <Layout
      title="ToolPin"
      description="The missing review gate for MCP installs."
    >
      <main className="home">
        <section className="hero hero--primary homeHero">
          <div className="container">
            <p className="eyebrow">MCP install governance</p>
            <h1 className="hero__title">ToolPin</h1>
            <p className="hero__subtitle">
              The missing review gate between MCP registries and the AI clients
              that run servers with your credentials. Inspect the install,
              write exact client config, commit <code>mcp-lock.json</code>, and
              fail CI when the reviewed state drifts.
            </p>
            <p className="heroClaim">
              Official/Docker metadata · 12 MCP clients · enforcing lockfile · local CI and policy
            </p>
            <div className="heroActions">
              <Link className="button button--secondary button--lg" to="/docs/tutorials/install-first-server">
                Quickstart
              </Link>
              <Link className="button button--outline button--secondary button--lg" to="/docs/reference/cli">
                CLI reference
              </Link>
            </div>
          </div>
        </section>
        <section className="homeBand">
          <div className="container featureGrid">
            <article>
              <h2>Why teams care</h2>
              <p>
                MCP servers are not editor themes. They can expose tools,
                credentials, local process access, and network access to an
                agent. ToolPin makes the approval visible.
              </p>
            </article>
            <article>
              <h2>Lockfiles as gates</h2>
              <p>
                Commit <code>mcp-lock.json</code> and run <code>toolpin ci</code>
                {" "}so pull requests fail when reviewed install plans drift.
              </p>
            </article>
            <article>
              <h2>Multi-client config</h2>
              <p>
                Generate JSON, TOML, or YAML for Claude, Cursor, VS Code,
                Codex, OpenCode, Continue, Gemini CLI, and more.
              </p>
            </article>
            <article>
              <h2>Honest trust checks</h2>
              <p>
                ToolPin checks declared pins and metadata. It does not claim
                byte-level OCI or MCPB verification.
              </p>
            </article>
            <article>
              <h2>Not another catalog</h2>
              <p>
                Registries find servers. Gateways govern runtime. ToolPin owns
                the repo-level layer between them: reviewed config, lockfile,
                and CI enforcement.
              </p>
            </article>
          </div>
        </section>
      </main>
    </Layout>
  );
}
