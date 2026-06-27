import {useLocation} from "@docusaurus/router";
import {useDocsVersion} from "@docusaurus/plugin-content-docs/client";
import OriginalDocItem from "@theme-original/DocItem";

function normalizePath(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

function findDocByPath(docs, pathname) {
  const normalizedPath = normalizePath(pathname);
  return Object.values(docs).find((doc) => normalizePath(doc.permalink) === normalizedPath);
}

export default function DocItem(props) {
  const location = useLocation();
  const version = useDocsVersion();
  const content = props.content;

  if (content && !content.metadata) {
    const metadata = findDocByPath(version.docs, location.pathname);
    if (metadata) {
      content.metadata = metadata;
      content.assets = content.assets ?? {};
    }
  }

  return <OriginalDocItem {...props} content={content} />;
}
