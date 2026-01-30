![Version](https://img.shields.io/badge/version-v1.0.0-blue)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)
![Status](https://img.shields.io/badge/status-stable-success)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

--- 
<a href="https://buymeacoffee.com/tukuexe" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" 
       alt="Buy Me A Coffee" 
       style="height: 60px; width: 217px;">
</a>

---

# Deterministic Research Engine (v1.0.0)

A deterministic, CLI-based web research engine designed to perform deep, structured research across hundreds of web pages without relying on large language models.

This project focuses on reliability, reproducibility, and control — not hallucinations or shallow summaries.

---

## Overview

This tool takes a research topic, expands it into structured questions, crawls the web deeply, extracts clean textual data, and synthesizes the collected information into a structured research output.

It is intentionally built without AI or LLMs in v1 to ensure:
- predictable behavior
- safe interruption
- non-corrupt outputs
- transparent data collection

The output can later be used as high-quality input for AI models, academic work, or business research.

---

## Why This Exists

Most AI chatbots:
- stop after 30–60 pages
- refuse to visit URLs
- hallucinate missing data
- provide shallow research

This engine:
- visits 100–200+ pages
- never refuses public URLs
- stores raw evidence
- separates crawling, storage, and synthesis cleanly

It is built to **gather truth first**, then analyze later.

---

## Features (v1)

- Deterministic research workflow
- Structured question and sub-question generation
- Deep web crawling with page limits
- Clean text extraction (no media, no HTML noise)
- Safe interruption (Ctrl+C / Ctrl+D)
- Guaranteed valid JSON output
- Heuristic-based synthesis (no AI)
- Designed for future LLM integration

---

## Requirements

- Node.js 18 or newer
- Internet connection
- Linux, macOS, Windows, or Termux supported

Check Node.js version:
node -v

---

## Setup

Clone the repository:
git clone https://github.com/ximantaxyz/deeptrace.git
cd DeepTrace/deeptrace

Install dependencies (if package.json exists):
npm install

Make the CLI executable (Linux / Termux):
chmod +x cli.js
---

## Usage

Run the research engine:
node cli.js

or
./cli.js

You will be prompted for:
1. Main research topic (required)
2. Optional focus or instruction
3. Optional list of seed URLs

Once started, the engine will:
- generate questions
- refine them into sub-questions
- crawl relevant pages
- store extracted data
- synthesize a structured research output

---

## Stopping the Program Safely

You can stop the program at any time using:
- Ctrl + C
- Ctrl + D

On interruption, the engine will:
- stop HTTP requests
- flush memory buffers
- save valid JSON files
- exit cleanly without corruption

---

## Output

Generated files include:

- `data/pages.jsonl`  
  Raw extracted text from visited web pages

- `data/questions.json`  
  Final structured question tree

- `output/report.json`  
  Synthesized research output (non-AI)

These outputs are ideal for:
- feeding into LLMs
- academic writing
- business research
- competitive analysis

---

## Design Philosophy

- Deterministic over probabilistic
- Evidence before interpretation
- Separation of concerns
- No hidden automation
- No silent failures

AI and LLMs are intentionally excluded from v1.

---

## Roadmap

- v2: LLM-assisted synthesis (OpenAI / local models)
- v3: Configurable crawling strategies
- v4: Web UI and API
- v5: Hosted research service

---

## Version

Current release: **v1.0.0 – Deterministic Research Engine**

---

## License

MIT License (or to be defined)
