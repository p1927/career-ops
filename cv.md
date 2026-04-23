# Pratyush Mishra

**Location:** Stockholm, Sweden | **Email:** 99pratyush@gmail.com | **GitHub:** github.com/p1927 | **LinkedIn:** linkedin.com/in/pratyush-mishra-9b400b87

---

## Professional Summary

Senior Software Engineer with 7+ years of experience, specializing in autonomous AI systems and LLM infrastructure. Currently at ASSA ABLOY Group (Stockholm) while building production-grade multi-agent orchestration systems as personal projects. Designed and shipped an end-to-end autonomous OS that runs self-healing Claude/Minimax workers 24/7, a voice-enabled AI coding agent (Shard), and a reactive cross-platform automations engine. IIT Roorkee graduate. Seeking AI Engineering roles where LLM systems, agent infrastructure, and applied ML are the core work.

---

## Work Experience

### Software Engineer -- ASSA ABLOY Group, Stockholm
**2017 - Present**
- Develop and maintain enterprise software for global access control and physical security product lines serving 50+ countries
- Led migration of legacy C++ access control firmware to modern microservices architecture (Python/FastAPI)
- Built internal developer tooling: LLM-assisted code review pipeline, automated regression test harness using Playwright
- Designed and deployed multi-model LLM routing infrastructure (Claude, Minimax, Groq, OpenRouter) as internal AI gateway
- Implemented executor gateway proxy: OpenAI-compatible API layer with circuit breakers, rate limiting, and cost-based model selection
- Stack: Python, FastAPI, C++, PostgreSQL, Docker, systemd, Linux

---

## Featured Projects

### Shard -- Voice-Enabled AI Coding Agent (2024-Present)
Real-time AI pair programmer with full transparency UI and voice interface.
- Architected Python/FastAPI backend + React/TypeScript frontend connected via WebSocket streaming; renders agent reasoning (tool calls, thinking, decisions) live in the UI as it happens
- Built modular STT/TTS audio pipeline: faster-whisper (configurable small/medium/large), voice activity detection, conversation ingest with streaming transcription
- Multi-model support: Claude Code (primary), Minimax M2.7, Gemini CLI as interchangeable backends; model routing via executor gateway
- UI transparency layer: TOOL_USE / TOOL_RESULT / THINKING telemetry, transcript drawer, decisions tab -- full agent observability in the browser
- Stack: Python, FastAPI, TypeScript, React, WebSocket, Docker, faster-whisper, Playwright

### Autonomous OS -- Self-Healing Multi-Agent System (2024-Present)
Production 24/7 agent orchestration system running as a systemd service.
- Designed supervisor + worker pattern: Telegram bot as user interface, supervisor agent plans and delegates, worker agents (Claude Code, Codex) execute tasks in isolated Docker sandboxes
- Built self-healing OS layer: watchdog agent detects stalled workers and model outages, memory cleaner reclaims page cache/Docker layers/npm on schedule, circuit breakers prevent cascade failures
- Multi-model routing engine: routes to Claude, Minimax, Groq, OpenRouter based on task complexity, cost, and provider health; handles failover transparently
- Executor Gateway: OpenAI-compatible reverse proxy serving 5+ LLM providers; supports /v1/messages and /v1/chat/completions; deployed as host-side systemd service
- Stack: Python, FastAPI, SQLite, Docker, systemd, Telegram Bot API, asyncio, Anthropic/OpenAI/Minimax SDKs

### LinkedIn Post Worker -- Cross-Platform Automations Engine (2024)
Reactive event-driven automation platform triggered by social media events.
- Designed modular automations architecture: each automation is an independent plug-and-play Python module exported via a unified interface; zero coupling between automation rules
- Supports 5 platforms as both trigger sources and action targets: LinkedIn, Instagram, YouTube, Gmail, Telegram
- Dual ingestion: webhook handlers for real-time events + polling fallback for platforms without webhooks
- Built 7-day rolling database cleanup pipeline with partitioned SQLite tables and automatic archival
- Stack: Python, PostgreSQL, SQLite, async queues, REST webhooks, OAuth2 (LinkedIn/Instagram/YouTube)

---

## Education

**B.Tech, Civil Engineering** -- Indian Institute of Technology (IIT) Roorkee, 2012-2017
- Focus on computational methods, structural simulation, MATLAB modeling

---

## Certifications

- HTML, CSS, and JavaScript for Web Developers -- Johns Hopkins / Coursera, 2018
- JavaScript, jQuery, and JSON -- Johns Hopkins / Coursera, 2018
- Building Web Applications in PHP -- University of Michigan / Coursera, 2018

---

## Technical Skills

**AI/LLM:** Anthropic Claude, OpenAI API, Minimax M2.7, Groq, faster-whisper (STT), multi-model routing, prompt engineering, autonomous agents, LLM evaluation

**Backend:** Python, FastAPI, asyncio, Node.js, Express, REST/WebSocket APIs, PostgreSQL, SQLite, Redis

**Infrastructure:** Docker, systemd, Linux, Cloudflare Tunnels, CI/CD, Playwright, circuit breakers, process supervision

**Frontend:** TypeScript, React, WebSocket streaming, Vite, HTML/CSS

**Languages:** English (professional), Hindi (native)
