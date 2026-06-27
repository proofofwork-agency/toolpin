## Summary

- 

## Curated Registry Changes

If this PR adds or updates ToolPin curated registry entries, edit the JSON directly:

- [ ] Updated `registry/v0/servers`
- [ ] Updated `website/static/registry/v0/servers` with identical contents
- [ ] Updated `metadata.count` and `metadata.total`
- [ ] Included an install target (`server.packages[]` or `server.remotes[]`)
- [ ] Included package/runtime details when needed (`runtimeHint`, `packageArguments`, `environmentVariables`, remote headers)
- [ ] Included `_meta["dev.toolpin/curation"]`
- [ ] Included `_meta["dev.toolpin/clientSupport"]`
- [ ] Documented per-client install support with `installMode`, `requirements`, `setupCommands`, and `notes` where applicable
- [ ] Ran `npm run registry:check`

## Validation

- [ ] `npm test`
- [ ] `npm run registry:check`

## Notes

- 
