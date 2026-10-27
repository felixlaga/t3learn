# Daily learning and chosen review

Open **Today** in the sidebar. The default budget is 30 minutes, adjustable each day and optionally saved as your default. It guides scope, never stops a lesson. When review is selected, Today allocates up to five minutes (one sixth of shorter budgets) to a brief review and the remainder to one main subject. **Continue to main subject** retains the chosen goal and remaining budget. The knowledge-map home and open-ended teaching/practice remain available.

## Goals and recommendations

**Goals** stores a title, subject, desired outcome, priority, status and editable ordered steps. Write the outline or explicitly ask your configured model to draft one. A draft is local form state until saved. Step completion and goal completion are your decisions, with a completion control in the linked lesson and an editable checklist on the goal.

Today recommends active goals with unfinished steps (or no outline), ordered by priority, then least recent learning activity at that priority. Opening a blank session does not count as studying. It chooses the first unfinished step, offers an existing session to resume, and highlights a specific failed review objective associated with the goal. Override the recommended goal or explore another topic whenever you like. Priority is dominant: this version does not automatically rotate away from a higher-priority active goal.

## Nothing enters review automatically

**Keep something in review** opens selection from a lesson. You can also choose material directly in **Review**: a knowledge-map proposition, reasoning chain, or manually written objective. Asking the selected model for lesson suggestions creates unchecked, editable proposals. Only **Keep this objective in review** or **Add selected objectives to review** enrolls material. Creating goals, teaching, importing notes and extracting the graph never enroll material, including within active goals.

Each item has an objective and a capability: explanation, assumptions, derivation, result interpretation, observables, validity/limits, application, diagnosis or trade-offs. Different capabilities can be reviewed separately for the same concept. A new item is untested and eligible for its first review. Today suggests up to two due/untested items, favoring other subjects, from this already chosen library. Review lets you select any active items, pause/resume them or remove them. Pausing a goal does not silently pause separately chosen review material.

## Grading and timing

The practice agent poses one problem at a time and records a separate assessment and reason for every objective it tests. Whole-problem outcomes and graph targets remain separate. Missing or uncertain evidence is unassessed; knowing a final result does not earn derivation credit.

| Evidence for an objective | Scheduler grade |
| --- | --- |
| Load-bearing reasoning demonstrated independently | Good |
| Correct with substantive, solution-bearing hints | Hard |
| Attempt did not demonstrate this capability | Again |
| Unassessed, skipped or dismissed | No scheduling change |

Arithmetic slips are distinguished from conceptual failures. Different objectives in one problem can receive different assessments. These are model judgments with reasons and links to recorded attempts, not certified mastery or measured probabilities of understanding.

Scheduling uses pinned `ts-fsrs` 5.4.2 (FSRS-6), target retention 0.9, deterministic timing without fuzz, and no minute-scale learning/relearning steps. Only the first assessed attempt for an objective in a session affects its interval; later retests remain visible as evidence. This prevents immediate correction after a reveal from extending the interval as if it were fresh recall. A separate session is a new sitting. There is no Easy grade or optimization against personal review history in this version.

Schedules replay cleanly acknowledged problem/conclude calls from saved review sessions. Failed tools, dangling calls, duplicate calls, ordinary practice and pre-enrollment attempts cannot grant review credit. Deleting a review chat removes its scheduling evidence on the next read. Removing and later enrolling an item creates a new, untested item; old sessions remain intact.

## Teaching by subject

- **Maths:** definitions and hypotheses, motivated proofs and derivations, method selection, counterexamples and limits.
- **Physics:** assumptions → derivation → result → observable predictions → limitations. Models, approximations, conventions and boundary/initial conditions stay explicit. Units, scaling, limiting cases and measurement connections are part of the reasoning.
- **Systems engineering:** execution traces, invariants, concurrency, consistency, failure modes, performance, observability and design trade-offs under constraints. Understanding systems is the focus; code may illustrate a mechanism.
- **Other interests:** explanation and evidence appropriate to the topic, with comparison and transfer where useful.

This guidance reaches probing, teaching and practice. Goal or selected review context is supplied from the server on each turn. A graph entry records encountered material, not proof of current understanding.

## Persistence

`learning.json` under the existing data directory stores versioned goals, explicit review items, session context and the default budget. Evidence stays in chat transcripts; schedules are derived. Reads do not write or call a model. Atomic updates include a revision check so a stale window cannot overwrite another window's changes. Invalid or newer-format records are refused rather than reset.

Private learning backup includes `learning.json` alongside chats and graph records. Restore both learning records and chats to retain evidence. See [learning-data.md](learning-data.md) for backup scope and attachment exclusions.

Inspired by [MasteryHarness](https://github.com/wangdepin/MasteryHarness), using [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs). T3Learn retains strictly explicit enrollment and assesses selected capabilities separately instead of copying one problem outcome to every target.
