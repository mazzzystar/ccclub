# Golden usage fixtures

These tiny, synthetic JSONL transcripts freeze accounting cases that have
caused real-world drift. They contain no real prompts, code, usernames, paths,
or session IDs.

The fixtures were run directly against these pinned upstream revisions:

- ccusage 20.0.17, commit `ba99c0d09b6db9fd64a6187751e8b88a019f991a`
- Vibe Usage 0.9.13, commit `8d78c23a7658f9e371980624d904c97b16b2e3d7`

`claude-fable-1h` matches ccusage exactly: 1,000 input, 200 output,
5,000 one-hour cache-write, 100,000 cache-read, 106,200 total tokens, and
$0.22. Vibe Usage deduplicates the replay but currently emits only 1,000
input, 200 output, and 100,000 cached-input tokens; its Claude parser does not
emit `cache_creation_input_tokens`. This is a documented upstream difference,
not a target for ccclub to imitate.

`codex-replay` produces 1,600 input, 320 output, and 1,920 total tokens in all
three implementations. ccclub's $0.00728 cost also matches ccusage; Vibe Usage
prices the uploaded bucket on its server rather than in the local parser.

`codex-reasoning` freezes Codex's output-token semantics: its 400,000
reasoning tokens are an informational subset of the 1,000,000 output tokens,
not an additional billable bucket. The expected $30.00041 matches ccusage;
adding reasoning a second time would incorrectly produce $42.00041.

The expected costs were also checked with direct per-token price arithmetic.

The fixtures are development/CI inputs only. ccclub users do not install or
run either comparison project.
