# Writing Manual Test Cases for Allure TestOps

Conventions that kept a large production suite readable and reviewable. Teams may override any of them; when a project has its own rules, those win.

## Workflow

1. **Search first.** Report what already exists, what conflicts, and what is missing (see the Searching section in SKILL.md). Design only the missing scenarios.
2. **Draft before pushing.** Write the test cases as a draft (in chat, or as Markdown files if the project keeps them) and let the user review.
3. **Push only on explicit instruction.** After approval, create them in Allure with the workflow in SKILL.md, verify each one, and report the new ids (and record them next to the drafts if drafts are kept as files).
4. **Keep the draft and Allure identical.** The Allure `name` is copied verbatim from the draft heading. Strip only a local numbering prefix like `TC-03: `; never rephrase while pushing.

## Field mapping

| Allure field | Content |
|---|---|
| `name` | One primary assertion, short (see Naming) |
| `description` | 1–2 sentences: "Verifies that …" — what behavior is checked and why it matters. Never preconditions |
| `precondition` | System state and test data (format below). Never put preconditions into `description` |
| steps | One action per step, each with its expected result |
| overall `expectedResult` | Optional; do not duplicate the last step's expected result as a separate "final result" block |
| tags | Area tags; `regression` for bug-reproduction cases |
| link | Exactly one link to the source ticket |

### Precondition format

A Markdown bullet list of preconditions, a blank line, a bold `**Test Data Required:**` heading, then a bullet list of data:

```
- User role: Administrator
- Feature flag "New checkout" is enabled

**Test Data Required:**
- Customer A: registered, has a saved card
- Product: any in-stock item priced above 100
- ⚠️ Missing: no customer with an expired card exists — create one first
```

Mark data that does not exist in the test environment with `⚠️ Missing:` and say what has to be created.

## Naming

- One primary assertion per name. Exact field names and values belong in description, precondition or steps.
- Use established domain abbreviations once the suite already uses them.
- Drop qualifiers that the context already implies.
- In an "X into Y" phrase, name the shared noun once ("Draft order into a subscription", not "Draft order item into a subscription item").
- Collapse an enumerated list of fields into one generic phrase.
- Cut trailing clauses that restate a secondary effect.
- **State the concrete behavior, never a bare negation.** Not "Price format unaffected by large amounts" but "Price format skips manual price prompt for large amounts". This applies to steps and expected results too.
- Never put a ticket key (e.g. `PROJ-123`) in the name. The ticket goes into the link.
- When a case targets a special mode or role, name it ("Restricted user sees masked customer name on order card"), and put the account in the precondition, not in the steps.

## Steps

- **One action per step.** Every click, type, navigate or select is its own step. Never chain actions with `,`, `;`, `and` or a dash.
- **Splitting rule:** "A and B" → two steps; "A, B, C" → three steps. When splitting, the original expected result goes to the last action (e.g. "Click Confirm").
- **One verification per expected-result line.** Several checks for one action go on separate lines (`\n` in the Allure `expectedResult`, separate `- Expected:` lines in a Markdown draft). Never use `;` to separate checks.
- **Specific data in every step**: "Enter customer A's email", never "enter customer details".
- **Exact UI labels** for buttons, tabs and fields, in quotes. Never invent action names.
- **Expected results in present tense and active voice**: "Order is displayed", not "The order should be displayed".
- **Describe the current state only.** No history, old names or renames ("column is labelled Tag", not "Tag, renamed from Note").
- **No explanations in parentheses** inside steps or expected results. Move rationale to the precondition or a note.
- No "Expected Final Result" block at the end. The final outcome is the expected result of the last relevant step.

## Scope of a test case

- **One scenario per test case.** No "Negative scenarios / edge cases" section inside a case: every positive or negative scenario gets its own case. When you find such a section in an existing case, extract each item into its own case.
- **Every bug fix gets a regression case** that reproduces the defect, tagged `regression`, linked to the bug ticket.
- **Paired cases for role- or permission-gated behavior**: for every restricted-mode case, write the privileged counterpart on the same screen with the same data. A suite with only the restricted side still passes when the gate is accidentally on for everyone.
- Keep purely technical checks (database migrations, backfills, data preserved after a rename) out of the manual suite unless the team asks for them; they belong in automated tests or the change's own review.

## Updating existing cases when functionality changes

1. Search with several keyword variations and read steps only for the cases that look relevant.
2. Classify each one: still correct / outdated (update it) / obsolete (propose archiving it to the user) / gap (draft a new case).
3. Apply the same atomicity and naming rules to edits as to new cases.
4. For bug fixes, check that a regression case exists, and draft one if it does not.
5. Report what was updated in Allure, what is drafted and awaiting approval, and what has no coverage, marked `⚠️ Area has NO existing test coverage`.
