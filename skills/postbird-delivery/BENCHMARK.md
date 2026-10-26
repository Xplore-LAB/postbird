# Evaluation Report — postbird-delivery

- Evaluation date: 2026-09-29
- Dataset: 6 authored cases in `evals/evals.json`
- Coverage: Trigger / Behavior / Boundary
- Repository baseline: **6/6 routing cases conform** as part of the project-wide 18/18 deterministic routing benchmark
- Live NVIDIA SkillEvaluator status: **not claimed until executed with a configured agent/runtime**

## Reproduce the repository baseline

From the repository root:

```bash
npm run skill:benchmark
```

The JSON report is written to `evidence/skill-routing-benchmark.json`.

## Important scope

This benchmark verifies the repository's deterministic routing fixtures. It is not an LLM accuracy claim and does not substitute for NVIDIA SkillEvaluator with-skill / without-skill live evaluation. See `docs/EVALUATION.zh-CN.md`.
