# Skill Card — postbird-action

- **Project:** Postbird
- **Skill:** `postbird-action`
- **Version:** 1.0.0
- **License:** MIT
- **Purpose:** Focused campus-office workflow skill used by the Postbird root orchestrator.
- **Data boundary:** Operates on user-authorized local indexes/files; no credential should be embedded in the skill.
- **High-risk action:** Real email delivery requires Postbird's preview + explicit confirmation guard.
- **Evaluation source:** `evals/evals.json`
- **Benchmark:** `BENCHMARK.md`
- **Known limitation:** Live model/agent uplift is not claimed until NVIDIA SkillEvaluator is actually run.
