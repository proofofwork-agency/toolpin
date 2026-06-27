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
            <p className="heroStatus">Pre-1.0 beta · Apache-2.0 · review aids, not a safety guarantee</p>
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
        <section className="demoBand">
          <div className="container demoLayout">
            <div className="terminalPanel" aria-label="Illustrative ToolPin install output (example, not a real server)">
              <div className="terminalChrome" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <p className="demoCaption">Illustrative example — <code>io.github.10iii/air</code> is a placeholder server, not a real registry entry.</p>
              <pre>
                <code>
                  <span className="prompt">$</span> toolpin install io.github.10iii/air --client claude --verify{"\n"}
                  <span className="muted">Resolving io.github.10iii/air from all registry source...</span>{"\n"}
                  <span className="muted">Installing io.github.10iii/air@0.2.8 into claude project config...</span>{"\n\n"}
                  <span className="heading">Install</span>{"\n"}
                  <span className="rule">--------</span>{"\n"}
                  {"  "}<span className="label">server</span>     <span className="value">io.github.10iii/air@0.2.8</span>{"\n"}
                  {"  "}<span className="label">registry</span>   <span className="value">official</span>{"\n"}
                  {"  "}<span className="label">trust</span>      <span className="value">87/100</span>{"\n"}
                  {"  "}<span className="label">verify</span>     <span className="ok">passed</span>{"\n"}
                  {"  "}<span className="label">scope</span>      <span className="value">project folder</span>{"\n"}
                  {"  "}<span className="label">clients</span>    <span className="value">claude</span>{"\n\n"}
                  {"  "}<span className="subhead">claude project</span>{"\n"}
                  {"  "}<span className="label">config</span>     <span className="ok">updated</span>: <span className="path">.mcp.json</span>{"\n"}
                  {"  "}<span className="label">lock</span>       <span className="ok">mcp-lock.json updated</span>{"\n"}
                  {"  "}<span className="note">- Project MCP config written.</span>{"\n"}
                  {"  "}<span className="note">- Requires Node.js and npm/npx on PATH.</span>{"\n"}
                  {"  "}<span className="label">done</span>       <span className="ok">installed for claude</span>
                </code>
              </pre>
            </div>
            <div className="artifactStack" aria-label="ToolPin generated artifacts">
              <div className="lockArtifact">
                <span className="fileIcon">{`{}`}</span>
                <strong>mcp-lock.json</strong>
                <span>sha256-9f2c3e...</span>
              </div>
              <div className="ciChip">
                <span>✓</span>
                toolpin ci --live · ready for required checks
              </div>
              <pre className="lockPreview">
                <code>{`{
  "lockfileVersion": 2,
  "servers": {
    "io.github.10iii/air:claude": {
      "name": "io.github.10iii/air",
      "version": "0.2.8",
      "client": "claude",
      "integrity": "sha256-9f2c3e..."
    }
  }
}`}</code>
              </pre>
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
                ToolPin separates metadata completeness from evidence-gated
                verification, including npm integrity, OCI digest, and
                allowlisted MCPB hash checks.
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
