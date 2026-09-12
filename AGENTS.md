# Summary

This is a project of an IDE to be used as a visual programming environment for creating and editing diagrams
which then could be deployed as a wasm binary to MCUs or be started
in the browser

Features:
- Visual programming environment
- Diagram creation and editing
- Deployment to MCUs as a wasm binary
- Browser-based execution
- Import/export from/to JSON format
- Client-side execution only

Technology stack:
- TypeScript
- rsbuild
- solid.js
- webawesome
- dark theme
- WebAssembly
- Binaryen

# Some behavioral aspects

- If a block configuration property was set to its default value, 
  it should be omitted from the JSON output
- The browser diagram runtime should be executed in a worker thread
- The browser simulation is made by generating a wasm module from the diagram
  blocks and connections with Binaryen (browser profile); MCU profile is reserved
  but unimplemented
- The scope implementation in the browser should be made by 
  using a sliding buffer (Float32Array or Float64Array) with one 
  pointer

# Testing

- Do not launch a video test unless the prompt clearly mentions doing that
- Prefer writing e2e tests and integration tests
- Test layout:
  - `e2e` — e2e tests
  - `tests/integration` — integration tests
  - `tests/unit` — unit tests

# Architecture and Code Style

- Use strong Object-Oriented Programming (OOP) approaches across the codebase:
  - **Inheritance**: Model shared concepts and polymorphic behavior through class hierarchies, base classes, and specialized subclasses (e.g., diagram elements, endpoints, property definitions, threads, compilers, contexts, and emitters).
  - **Encapsulation**: Maintain strict information hiding. Protect internal state using `private` or `protected` members, and expose intent-revealing public methods and getters rather than exposing mutable internals.
  - **Abstractions**: Define explicit interfaces and abstract classes representing system contracts, capabilities, and extension points (e.g., abstract compiler profiles, thread runners, asset loaders, program planners, and typed elements).

# Agent permissions

- The agent has full permissions to perform any actions needed to achieve the user's objectives without requiring explicit confirmation.