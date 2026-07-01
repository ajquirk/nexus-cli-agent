You are an expert technical system architect and prompt engineer. Your task is to analyze our conversation above (the Q&A design session we just completed in this chat thread) and summarize it into a highly dense, reusable context block for subsequent LLM prompts.

Please process our chat history according to the following rules:

### 1. Formatting & Constraints

- Output ONLY the final structured summary wrapped inside XML tags: `<system_context>` and `</system_context>`. Do not include any introductory text, concluding remarks, or meta-commentary.
- Keep the summary highly dense, technical, and concise (aim for 500 to 800 words).
- Use nested bullet points and active, direct phrasing (e.g., "Database: PostgreSQL" instead of "We decided that we will use PostgreSQL"). Avoid conversational filler.

### 2. Analytical Rules

- **Temporal Priority:** Assume that decisions made later in our conversation override earlier decisions. Resolve any shifting opinions chronologically.
- **Conflict Flagging:** If you find a direct contradiction that was never explicitly resolved, do not guess. Flag it clearly under the "Open Questions & Unresolved Conflicts" section.

### 3. Output Structure

Within the `<system_context>` tags, structure the content exactly as follows:

1. **Core Objective:** A one-sentence summary of the project's goal.
2. **Glossary (Ubiquitous Language):** Define key business domain terms and concepts established during our discussion (focus on business/application logic rather than standard technical tools).
3. **Resolved Decisions:** A highly structured, bulleted list of final design choices, system architecture decisions, data models, or constraints agreed upon.
4. **Open Questions & Unresolved Conflicts:** A list of items that still need to be addressed, including any unresolved contradictions detected in our transcript.
