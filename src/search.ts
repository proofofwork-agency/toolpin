import type { NormalizedServer, SearchResult } from "./types.js";
import { scoreServer } from "./trust.js";

export function searchServers(servers: NormalizedServer[], query: string, limit = 10): SearchResult[] {
  const terms = tokenize(query);
  return servers
    .map((server) => {
      const relevance = scoreRelevance(server, terms);
      return { server, relevance, trust: scoreServer(server) };
    })
    .filter((result) => result.relevance > 0)
    .sort((a, b) => b.relevance + b.trust.score / 100 - (a.relevance + a.trust.score / 100))
    .slice(0, limit);
}

function scoreRelevance(server: NormalizedServer, terms: string[]): number {
  const haystacks = [
    { value: server.name, weight: 8 },
    { value: server.title, weight: 6 },
    { value: server.description, weight: 3 },
    { value: server.packageTypes.join(" "), weight: 2 },
    { value: server.transports.join(" "), weight: 2 },
    { value: server.repositoryUrl ?? "", weight: 1 },
  ];

  return terms.reduce((score, term) => {
    const termScore = haystacks.reduce((inner, haystack) => {
      return inner + (haystack.value.toLowerCase().includes(term) ? haystack.weight : 0);
    }, 0);
    return score + termScore;
  }, 0);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}
