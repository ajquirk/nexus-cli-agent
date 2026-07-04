nexus
├── .gitignore
├── docs
├── package-lock.json
├── package.json
├── prompts
├── src
│   ├── config
│   │   ├── ConfigManager.test.ts
│   │   └── ConfigManager.ts
│   ├── execution
│   │   ├── SafeCommandExecutor.test.ts
│   │   ├── SafeCommandExecutor.ts
│   │   ├── SafeCommandValidator.test.ts
│   │   └── SafeCommandValidator.ts
│   ├── git
│   │   ├── GitValidator.test.ts
│   │   ├── GitValidator.ts
│   │   ├── SandboxBranchManager.test.ts
│   │   └── SandboxBranchManager.ts
│   ├── llm
│   │   ├── LLMOrchestrator.test.ts
│   │   └── LLMOrchestrator.ts
│   ├── patch
│   │   ├── PatchExecutor.test.ts
│   │   └── PatchExecutor.ts
│   ├── storage
│   │   ├── SQLiteStorageManager.test.ts
│   │   └── SQLiteStorageManager.ts
│   └── terminal
│       ├── TerminalInterface.test.ts
│       └── TerminalInterface.ts
└── tsconfig.json
