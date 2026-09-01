# AGENTS.md

## Project

Internal Export Cost Calculator.

Read before making changes:

- docs/PRD.md
- docs/ARCHITECTURE.md
- docs/CALCULATION_RULES.md

## Product Principle

Complex engine, simple interface.

Do not expose technical fields to users unless necessary.

## Engineering Rules

- Keep calculation/business logic separate from UI.
- Do not duplicate calculation formulas.
- Financial calculations must use decimal-safe arithmetic.
- Add unit tests for all calculation changes.
- Do not modify unrelated files.
- Do not add dependencies unless necessary.
- Prefer simple implementations over premature abstraction.
- Do not build features outside the PRD.
- Do not implement future/backlog features without being asked.

## Git

- Do not force push.
- Do not rewrite main history.
- Do not commit secrets.
- Do not make unrelated refactors.

## Definition of Done

Before completing a task:

1. Build passes.
2. Tests pass.
3. Lint passes.
4. Relevant calculation tests exist.
5. Summarize changed files.
6. Mention remaining limitations.