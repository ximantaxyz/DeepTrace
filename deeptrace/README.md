# DeepTrace

**DeepTrace** is a deterministic, CLI-based web research engine designed for structured, repeatable, and auditable investigations.  
It focuses on *methodical question generation, controlled web inspection, and reproducible outputs* — not chat-style AI guessing.

> Built for researchers, students, founders, and engineers who need **systematic research**, not random summaries.

---

## What DeepTrace Does (v1)

DeepTrace v1 is a **non-AI deterministic research pipeline** that:

- Generates structured research questions
- Refines questions into sub-questions
- Visits and inspects real web pages
- Extracts and stores research data
- Synthesizes findings into structured outputs
- Ensures reproducibility (same input → same behavior)

No hallucinations. No black-box reasoning.

---

## Key Features

- Deterministic execution flow
- CLI-first design
- Graceful shutdown & recovery
- Safe interruption handling (Ctrl+C)
- JSON-based storage (non-corrupting)
- Question tree refinement
- Page inspection with limits
- Modular architecture
- Node.js compatible
- Works in **Linux, macOS, Windows, Termux**

---

## What DeepTrace v1 Is NOT

- ❌ Not an AI chatbot
- ❌ Not a crawler that scrapes everything blindly
- ❌ Not probabilistic or random
- ❌ Not dependent on OpenAI / Ollama / LLMs (yet)

AI integration is planned for **v2+**, but **v1 is intentionally deterministic**.

---

## Project Structure

```
deeptrace/
├── cli.js            # CLI entry point
├── questioner.js     # Initial question generation
├── refiner.js        # Question tree refinement
├── inspector.js      # Web page inspection logic
├── storage.js        # Persistent JSON storage
├── synthesizer.js    # Final synthesis engine
├── package.json
├── README.md
└── .gitignore
```

---

## Installation

### Requirements
- Node.js **v18 or newer**
- npm

### Global Install (recommended)
```bash
npm install -g deeptrace
```

Run anywhere:
```bash
deeptrace
```

### Local Install (repo)
```bash
git clone https://github.com/ximantaxyz/DeepTrace.git
cd DeepTrace
npm install
node cli.js
```

---

## How It Works (Execution Flow)

1. User provides:
   - Main research topic
   - Optional instructions
   - Optional seed URLs
2. DeepTrace:
   - Generates base questions
   - Refines into sub-questions
   - Inspects web pages per question
   - Stores extracted data safely
3. Synthesis step:
   - Produces a structured research output
4. User can interrupt safely at any time

---

## CLI Usage

```bash
deeptrace
```

You will be prompted for:
- Research topic
- Optional focus
- Optional URLs

Progress is displayed live:
- Current question
- Pages visited
- Safe shutdown supported

---

## Output & Storage

- Research data stored as **valid JSON**
- No corrupted files on exit
- Intermediate data preserved
- Designed for later AI or analysis pipelines

---

## Design Philosophy

> “Make it deterministic first. Intelligence comes later.”

DeepTrace prioritizes:
- Control over automation
- Transparency over magic
- Structure over speed
- Reliability over hype

---

## Roadmap

### v1 (current)
- Deterministic research engine
- CLI-based execution
- Modular architecture

### v2 (planned)
- AI-assisted synthesis
- Multi-model orchestration
- Web automation intelligence
- Query refinement via LLMs
- Research caching & replay
- Plugin system

---

## Founder

**Himanta Bhuyan**  
Founder & Developer  
GitHub: https://github.com/ximantaxyz  
Email: ximanta.official@gmail.com  
Website: https://deeptrace.ximanta.space

---

## License

MIT License  
Free to use, modify, and extend.

---

## Final Note

DeepTrace is built to grow.  
v1 is the foundation — deterministic, boring, reliable.

Everything powerful comes next.
