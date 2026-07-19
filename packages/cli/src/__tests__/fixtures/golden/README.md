# Golden usage fixtures

These tiny, synthetic JSONL transcripts freeze accounting cases that have
caused real-world drift. They contain no real prompts, code, usernames, paths,
or session IDs.

The fixtures were run directly against these pinned upstream revisions:

- ccusage 20.0.17, commit `7acee6c5853c26fe66fbe1453bd94c9376afec06`
- Vibe Usage 0.9.15, commit `a13b7870cecad6ca97de4cbf9f6023a1346faf4d`

`claude-fable-1h` matches ccusage exactly: 1,000 input, 200 output,
5,000 one-hour cache-write, 100,000 cache-read, 106,200 total tokens, and
$0.22. Vibe Usage deduplicates the replay but currently emits only 1,000
input, 200 output, and 100,000 cached-input tokens; its Claude parser does not
emit `cache_creation_input_tokens`. This is a documented upstream difference,
not a target for ccclub to imitate.

`codex-replay` produces 1,600 input, 320 output, and 1,920 total tokens in all
three implementations. ccclub's $0.00728 cost also matches ccusage; Vibe Usage
prices the uploaded bucket on its server rather than in the local parser.

`codex-last-n-replay` freezes the newer Codex fork layout: the child retains
only the final two parent token records, re-stamps them, then starts its own
turn. ccclub and Vibe Usage both count 1,050 input, 105 output, and 1,155 total
tokens. ccusage 20.0.17 still uses the older same-second heuristic, so this
fixture documents its known inflated result (1,750 input, 175 output, 1,925
total) as an upstream gap rather than treating it as authoritative.

`codex-reasoning` freezes Codex's output-token semantics: its 400,000
reasoning tokens are an informational subset of the 1,000,000 output tokens,
not an additional billable bucket. The expected $30.00041 matches ccusage;
adding reasoning a second time would incorrectly produce $42.00041.

The expected costs were also checked with direct per-token price arithmetic.

The fixtures are development/CI inputs only. ccclub users do not install or
run either comparison project.
