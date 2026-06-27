import type { NormalizedServer, SearchResult } from "./types.js";
import { scoreServer } from "./trust.js";

export function searchServers(servers: NormalizedServer[], query: string, limit = 10): SearchResult[] {
  const terms = tokenize(query);
  const knownSources = new Set(servers.map((server) => server.registrySource));
  const sourceTerms = new Set(terms.filter((term) => knownSources.has(term)));
  const textTerms = terms.filter((term) => !sourceTerms.has(term));
  const scoringTerms = textTerms.length ? textTerms : terms;
  return servers
    .filter((server) => !sourceTerms.size || sourceTerms.has(server.registrySource))
    .map((server) => {
      const relevance = scoreRelevance(server, scoringTerms);
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
    { value: server.registrySource, weight: 5 },
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
