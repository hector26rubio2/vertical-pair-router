# AI Hero adaptation

Upstream: https://github.com/mattpocock/skills

- Pinned commit: `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`
- Audited: 2026-11-09
- License: MIT, Copyright (c) 2026 Matt Pocock
- Observed catalog: 20 engineering + 7 productivity Skills (27 total)
- Integration choice: ideas and procedures are adapted into original VPR
  Spanish Skills; the upstream package is not a runtime dependency.

## Audited source files

| Upstream file | SHA-256 |
|---|---|
| `skills/engineering/grill-with-docs/SKILL.md` | `abc0fa7948db18b5fb0e1cc1c522ac5ff47d874e2da1e5df60619d79be11f38b` |
| `skills/productivity/grilling/SKILL.md` | `ec91c3f684a0a6323eaf30faa26d3aac5b95f28811eca6d4f108138934063c5c` |
| `skills/productivity/grill-me/SKILL.md` | `19e660207b447acf6ee0d600471c02e549c7aca8fb3ab38fdc2c7056aa442fc8` |
| `skills/engineering/domain-modeling/SKILL.md` | `b62d997256cc073e123d4303da8e9db00db0e28de9739660ca3e55ab76e09cdb` |
| `skills/engineering/wayfinder/SKILL.md` | `da3b9ce26c5128c8bd5b0099f262132320e72341544146196d81987edc62b58a` |
| `skills/engineering/to-spec/SKILL.md` | `c73a2250beac0479e384f5466e834bb54ce6e30b7f8705e9999ba840d9d59b36` |
| `skills/engineering/to-tickets/SKILL.md` | `b8eb6dca1085e85220b0f5990ed787ebf8a924844d090689f1073b06367e2f7a` |
| `skills/engineering/implement/SKILL.md` | `83042ad79e3d7ce616124bf59a38a5ebe79417adb36bedfc4e6223aab783be8c` |
| `skills/engineering/tdd/SKILL.md` | `969583080caf842ae86a53501a0091eced13fd89cad65d3aa75c09112318ff33` |
| `skills/engineering/diagnosing-bugs/SKILL.md` | `aa87b0ac245c6d1b203c4678eb34dc101af02291448780c55c5e58ccc1619bd7` |
| `skills/productivity/handoff/SKILL.md` | `739d8fbe3e6ed688581eb62b35f04834822eae47e57bc35a79c8d8dc9ac703d3` |
| `skills/engineering/code-review/SKILL.md` | `36847f010579f3bccd54c49793e1fd043f10cc49b4607bac5a3067522e528b91` |
| `skills/engineering/retro/SKILL.md` | `42110f533f169026d037cf141b9f6c2752c6d914903be4758c38a68349e83e78` |
| `skills/engineering/improve-codebase-architecture/SKILL.md` | `ab526ca26246137fe96048b072d93aeff45f763da5e6c0eca5e51012dfd34433` |

## Adaptation decisions

- `grilling`, `grill-with-docs`, and `grill-me` inform `vpr-grill`, but VPR
  outputs `StoryDraft`/`StoryPatch` through `BacklogService`; it does not require
  an intermediate spec or issue tracker.
- `domain-modeling` keeps one canonical project glossary and sparse ADRs, but
  changes are proposals/diffs requiring approval.
- `wayfinder` informs phase boundaries and decision frontiers; VPR does not
  require an external issue tracker.
- `to-tickets` informs vertical Tasks and real dependency edges.
- `implement` and `tdd` inform `vpr-feature`/`vpr-bugfix`; VPR removes automatic
  commit and requires runtime Evidence.
- `diagnosing-bugs` informs `vpr-diagnose`, including a red-capable feedback loop
  before root-cause claims.
- `code-review` informs two separate axes in `vpr-review`; parallel reviewers
  are optional and recursive review is forbidden.
- `retro` informs `vpr-retro`, but improvements are proposed, never auto-applied.
- `handoff` becomes a compact referenced checkpoint only when work crosses a
  session/agent/person boundary.
- `to-spec` is optional for multi-session/high-risk work; it is not backlog
  authority.
- `ask-matt`, `implement-spec`, and `setup-matt-pocock-skills` are deliberately
  not copied because they would duplicate routing, orchestration, profiles, or
  tracker authority.

No upstream script, agent definition, shell template, glossary format, or
runtime package was copied. The upstream MIT notice is preserved in
`THIRD-PARTY-NOTICES.md` for the adapted methodology.

