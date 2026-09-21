<img src="ui/public/icons/bigbld.svg" alt="BLD Logo" width="640" height="320" style="margin-bottom: -80px"/>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-clang%2Flld-654FF0.svg)](https://webassembly.org/)
[![C++](https://img.shields.io/badge/C%2B%2B-base%20library-00599C.svg)](https://isocpp.org/)
[![Solid.js](https://img.shields.io/badge/Solid.js-1.9-2c4f7c.svg)](https://www.solidjs.com/)
[![Rsbuild](https://img.shields.io/badge/Rsbuild-Fast%20Builds-F43F5E.svg)](https://rsbuild.dev/)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-orange.svg)](LICENSE)

> A modern, client-side Visual Programming IDE and compiler for creating, editing, and executing reactive dataflow diagrams. Diagrams are translated to **C++** against the native base library and compiled in the browser to **WebAssembly** with **clang/lld**, running isolated inside Web Worker threads, with an MCU deployment target reserved for embedded devices.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture & Monorepo Layout](#architecture--monorepo-layout)
- [System Architecture](#system-architecture)
- [Compilation Pipeline](#compilation-pipeline)
- [Worker Threading & Host Communication](#worker-threading--host-communication)
- [Scope Buffers & Pin Inspection](#scope-buffers--pin-inspection)
- [Object-Oriented Design & Class Hierarchies](#object-oriented-design--class-hierarchies)
- [Type System & Inference](#type-system--inference)
- [Standard Block Library (`base`)](#standard-block-library-base)
- [JSON Diagram Specification & Schemas](#json-diagram-specification--schemas)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Build](#build)
  - [Running the Development Server](#running-the-development-server)
  - [Running Tests](#running-tests)
- [Testing Strategy](#testing-strategy)
- [License](#license)

---

## Overview

**bld** provides a modular, visual programming environment designed for high-performance reactive computation. Users build diagrams from typed blocks (sources, mathematical transformers, filters, sinks, and hardware I/O pins) connected by vectorized stream channels.

The project features a **client-side only** architecture:
1. **Visual Diagram Modeling**: Interactive canvas for assembling signal processing pipelines and reactive control algorithms.
2. **C++ to WebAssembly Compilation**: The diagram is emitted as C++ against the native base library and compiled in the browser with clang/lld.
3. **Isolated Threaded Simulation**: Generated WebAssembly binaries execute in dedicated **Web Worker threads**, keeping UI rendering responsive at 60 FPS while streaming real-time pin observations back to the host.

---

## Key Features

- **Pure Client-Side Execution**: Zero backend dependencies; compilation and execution take place entirely within the browser.
- **C++ Diagram Builder**: Generates C++ that instantiates `push::f32` blocks from the base library and delegates wasm compilation to the `cpp` workspace.
- **Web Worker Thread Isolation**: All runtime execution runs off the main thread with non-blocking RPC communication and streaming pin updates.
- **Sliding Scope Buffers**: High-rate signal capture in the browser uses a `Float32Array`/`Float64Array` ring with a single write pointer.
- **Parametric Type System**: Full support for primitive types (`f32`, `i32`, `bool`), type variables (`?T`), and parameterized stream types (`pss<f32>`) with automatic bidirectional type inference.
- **JSON Schema-Backed Serialization**: Clean JSON diagram format adhering to formal JSON Schemas. Properties matching default values are automatically omitted for clean version control diffs. Block refs and `cpp` class names match the native `push::f32` library.
- **Production-Ready UI Stack**: Built on Solid.js, Web Awesome, dark mode by default, and bundled with Rsbuild.

---

## Architecture & Monorepo Layout

The repository is structured as an npm multi-workspace monorepo:

```
bld/
├── base/        # Native C++ block library (`base/native`) and header assets
├── core/        # Domain model, Diagram, TypeSystem, Schemas, and C++ diagram builder
├── runtime/     # Wasm session, worker bridge, sliding scope buffers
├── cpp/         # In-browser clang/lld compilation
└── ui/          # Solid.js frontend, canvas, Web Awesome components, worker runners, and Rsbuild config
```

### Package Responsibilities

| Package | Purpose | Key Responsibilities |
|---|---|---|
| **`runtime`** | Wasm session & scopes | Worker RPC (`WasmRuntime`, `WasmSession`), WASI/env bindings, sliding scope buffers. |
| **`base`** | Native C++ library | `push::f32` blocks in `base/native` (`ScopeF32`, `SumF32`, `ProductF32`, `GpioInF32`, generators) plus `wasm_host` exports used by generated diagrams. |
| **`core`** | Domain model & C++ builder | `Diagram`, `Palette`, `Library`, `TypeSystem`, `CppDiagramBuilder`, `DiagramCompiler` (delegates wasm compilation to `cpp`). |
| **`cpp`** | In-browser clang/lld | Compiles generated C++ sources to wasm and executes the module in a worker. |
| **`ui`** | User Interface & Worker Host | Solid.js web app, dark UI theme, canvas interactions, Rsbuild dev server, Cloudflare Pages deployment configuration (`wrangler.json`), browser Worker hosting (`run.worker.ts`). |

---

## System Architecture

The following diagram illustrates the dependency topology and system boundaries across the packages and host environments:

```mermaid
graph TD
    subgraph BrowserUI["Browser Main Thread (UI)"]
        UI["ui (Solid.js + Web Awesome)"]
        Canvas["Diagram Canvas & Controls"]
        UIState["UI Reactive State"]
        WasmRT["WasmRuntime (Host Bridge)"]
        
        UI --> Canvas
        Canvas --> UIState
        UIState --> WasmRT
    end

    subgraph CoreDomain["Core Domain & Modeling"]
        Core["core"]
        Diag["Diagram / DiagramBlock / Connection"]
        TS["TypeSystem & TypeInference"]
        CompilerFacade["DiagramCompiler"]
        Builder["CppDiagramBuilder"]

        Core --> Diag
        Core --> TS
        Core --> CompilerFacade
        CompilerFacade --> Builder
    end

    subgraph RuntimePackage["Runtime"]
        Runtime["runtime"]
        Session["WasmSession"]
        ThreadMod["Thread & WorkerClient"]
        Buffers["SlidingScopeBuffer"]

        Runtime --> Session
        Runtime --> ThreadMod
        Runtime --> Buffers
    end

    subgraph BaseLib["Standard Library"]
        Base["base"]
        Native["base/native (base.hpp, wasm_host.cpp)"]
        Base --> Native
    end

    subgraph CppPkg["cpp clang/lld"]
        Cpp["cpp"]
        Clang["ClangFrontend"]
        Lld["WasmLinker"]
        Cpp --> Clang
        Cpp --> Lld
    end

    subgraph WorkerEnv["Web Worker Thread"]
        WorkerEntry["wasm/run.worker.ts"]
        WasmInst["WebAssembly.Instance"]
        SharedMem["Linear Memory & GC Arrays"]
        EnvBridge["Host Env Imports (sendPinF32, cos, sin)"]

        WorkerEntry --> WasmInst
        WasmInst --> SharedMem
        WasmInst --> EnvBridge
    end

    UI --> Core
    UI --> Runtime
    Core --> Base
    Runtime --> Cpp
    CompilerFacade -->|"ICppCompiler"| Cpp
    Builder --> Native
    WasmRT <==>|"postMessage / RPC"| WorkerEntry
    EnvBridge -.->|"Real-time Pin Push"| WasmRT
```

---

## Compilation Pipeline

When a diagram is executed, `CppDiagramBuilder` emits C++ against the native base library and `DiagramCompiler` delegates wasm compilation to the `cpp` workspace:

```mermaid
flowchart TD
    A["Diagram Model / DiagramJson"] --> B["CppDiagramBuilder"]
    
    subgraph Emit["C++ Generation"]
        B --> B1["Map JSON refs to push::f32 classes"]
        B1 --> B2["Reverse-topo apply order (sinks before sources)"]
        B2 --> B3["Emit diagram.cpp + native headers/host"]
    end
    
    B3 --> C["Map of C++ files"]
    
    subgraph ClangLld["cpp clang/lld"]
        C --> D["ICppCompiler.compile(files)"]
        D --> E["clang++ -std=c++23 wasm32-emscripten"]
        E --> F["wasm-ld --export-all"]
    end
    
    F --> G["Uint8Array Wasm Binary"]
    G --> H["Web Worker instantiate + start()"]
```

---

## Worker Threading & Host Communication

To maintain 60 FPS in the user interface, WebAssembly execution is completely offloaded to a Web Worker. Communication is managed over an asynchronous message-passing RPC bridge:

```mermaid
sequenceDiagram
    autonumber
    participant UI as Host UI Thread (WasmRuntime / WasmSession)
    participant Worker as Web Worker (run.worker.ts)
    participant Wasm as WebAssembly Instance

    UI->>Worker: postMessage({ id: 1, type: "instantiate", wasm: bytes })
    Worker->>Wasm: WebAssembly.instantiate(bytes, hostImports)
    Wasm-->>Worker: Instance ready
    Worker-->>UI: postMessage({ id: 1, type: "ok" })

    Note over UI,Worker: Session active - Simulation Running

    UI->>Worker: postMessage({ id: 2, type: "invoke", name: "tickThenObserve", args: [] })
    Worker->>Wasm: exports.tickThenObserve()
    
    activate Wasm
    loop On Output Pin Writes
        Wasm->>Worker: host.sendPinF32(blockId, pin, value)
        Worker-->>UI: postMessage({ type: "pin", blockId, pin, value })
        UI->>UI: Update Canvas Scope / Probes
    end
    Wasm-->>Worker: return status
    deactivate Wasm

    Worker-->>UI: postMessage({ id: 2, type: "ok", result: 0 })

    opt GPIO or Hardware Trigger
        UI->>Worker: postMessage({ id: 3, type: "invoke", name: "emitGpioIn", args: [blockId, pin, 1] })
        Worker->>Wasm: exports.emitGpioIn(blockId, pin, 1)
        Worker-->>UI: postMessage({ id: 3, type: "ok", result: 0 })
    end
```

---

## Scope Buffers & Pin Inspection

Browser scopes keep samples in a JavaScript sliding buffer (`SlidingScopeBuffer`): a `Float32Array` or `Float64Array` plus a single write pointer. The wasm host records the latest pin values and write counts for inspection:

- `lastPin(blockId, pin)`, `hasPin(blockId, pin)`, `pinWriteCount()`
- `emitGpioIn(blockId, pinIndex, value)` to inject GPIO edges
- `setNow` / `setRandom` for deterministic generator tests
- `tick` / `tickThenObserve` to fire registered intervals

Host pin updates are pushed through `env.host_sendPinF32` so the UI can append samples to sliding buffers without polling wasm memory.

---

## Object-Oriented Design & Class Hierarchies

Following the codebase's strict Object-Oriented Programming (OOP) standard, core capabilities are modeled through inheritance, strict encapsulation, and clean contracts:

```mermaid
classDiagram
    direction TB

    %% Thread Hierarchy
    class Thread {
        <<abstract>>
        +postMessage(data: unknown)* void
        +onMessage(handler)* void
        +onError(handler)* void
        +terminate()* Promise
    }
    class EventTargetWorkerThread {
        -worker: EventTargetWorkerLike
        +postMessage(data: unknown) void
        +onMessage(handler) void
        +onError(handler) void
        +terminate() Promise
    }
    Thread <|-- EventTargetWorkerThread

    %% Runtime Hierarchy
    class AbstractWasmRuntime {
        <<abstract>>
        +instantiate(wasm: Uint8Array)* Promise~WasmSession~
        +close()* Promise~void~
    }
    class WasmRuntime {
        -run: WorkerClient
        +instantiate(wasm: Uint8Array) Promise~WasmSession~
        +close() Promise~void~
    }
    AbstractWasmRuntime <|-- WasmRuntime

    %% Compiler Hierarchy
    class CompilationModel {
        #profile: WasmProfile
        -files: Map~string, string~
        +getProfile() WasmProfile
        +setProfile(profile) void
        +addFile(name, content) void
        +getFile(name) string
    }
    class DiagramCompiler {
        -cppCompiler: ICppCompiler
        +emitFiles(diagram) Map
        +emitText(diagram) string
        +compile(diagram, options) Promise~Uint8Array~
        +run(diagram, runtime, options) Promise~WasmSession~
    }
    class BrowserCompiler {
        +constructor(libraryFiles, cppCompiler)
    }
    class McuCompiler {
        +constructor(libraryFiles)
    }
    CompilationModel <|-- DiagramCompiler
    DiagramCompiler <|-- BrowserCompiler
    DiagramCompiler <|-- McuCompiler

    class DiagramSourceBuilder {
        <<abstract>>
        +build(diagram)* Map
    }
    class CppDiagramBuilder {
        +build(diagram) Map
        +emitDiagram(diagram) string
    }
    class CppBlockCatalog {
        +require(ref) CppBlockBinding
    }
    DiagramSourceBuilder <|-- CppDiagramBuilder
    CppDiagramBuilder --> CppBlockCatalog
```

---

## Type System & Inference

The type system defines safety guarantees for vector connections between block ports:

```mermaid
classDiagram
    direction TB
    class DataType {
        <<abstract>>
        +raw: string*
        +name: string*
        +toString()* string
        +equals(other: DataType)* boolean
    }
    class PrimitiveType {
        +raw: string
        +name: string
        +compatibleWith: ReadonlySet~string~
        +isArgCompatibleWith(sourceRaw) boolean
    }
    class ParameterizedType {
        +raw: string
        +name: string
        +args: ReadonlyMap~string, DataType~
        +getArg(paramName) DataType
    }
    class TypeVariable {
        -boundType: DataType
        +name: string
        +isBound() boolean
        +bind(concrete: DataType) void
        +unbind() void
    }
    DataType <|-- PrimitiveType
    DataType <|-- ParameterizedType
    DataType <|-- TypeVariable

    class TypeSystem {
        -types: Map~string, DataType~
        +register(type: DataType) void
        +resolve(descriptor: TypeDescriptor) DataType
        +isAssignable(source: DataType, target: DataType) boolean
    }
    class TypeInference {
        -typeSystem: TypeSystem
        +inferConnection(fromType: DataType, toType: DataType) boolean
        +unify(a: DataType, b: DataType) DataType
    }

    TypeSystem --> DataType
    TypeInference --> TypeSystem
```

- **Primitive Types**: Standard scalar values: `f32`, `i32`, `i64`, `bool`, `string`.
- **Parameterized Types**: Generic collections and stream wrappers, e.g., `pss<f32>` (push-stream scalar).
- **Type Variables**: Unbound variables (e.g. `?T`) automatically unified during connection validation.

---

## Standard Block Library (`base`)

The standard library includes fundamental building blocks for digital signal processing, simulation, and hardware interfacing:

| Block Reference | Category | Inputs | Outputs | Description |
|---|---|---|---|---|
| `const_f32` | Source | None | `v` (`pss<f32>`) | Emits a constant floating-point value. |
| `sin_gen_f32` | Source | None | `v` (`pss<f32>`) | Periodic harmonic sine wave generator over time. |
| `cos_gen_f32` | Source | None | `v` (`pss<f32>`) | Periodic harmonic cosine wave generator over time. |
| `rand_gen_f32` | Source | None | `v` (`pss<f32>`) | Pseudo-random uniform noise generator. |
| `pulse_gen_f32` | Source | None | `v` (`pss<f32>`) | Square wave pulse generator with configurable period and duty cycle. |
| `gpio_in_f32` | Source | Hardware Pin | `pin` (`pss<f32>`) | Multi-pin digital GPIO input with reactive push notification. |
| `sin_f32` | Transformer | `v` (`pss<f32>`) | `sin` (`pss<f32>`) | Unary sine function applied to incoming push values. |
| `cos_f32` | Transformer | `v` (`pss<f32>`) | `cos` (`pss<f32>`) | Unary cosine function applied to incoming push values. |
| `sum_f32` | Transformer | `v` (vector `pss<f32>`) | `s` (`pss<f32>`) | Multi-channel vector summation. |
| `product_f32` | Transformer | `v` (vector `pss<f32>`) | `p` (`pss<f32>`) | Multi-channel vector multiplication. |
| `scope_f32` | Sink | `sink` (vector `pss<f32>`) | None | Sliding circular buffer oscilloscope for real-time visualization. |

---

## JSON Diagram Specification & Schemas

Diagrams are serialized in a declarative JSON format validated against formal JSON Schemas in `core/assets/schemas/`:

```json
{
  "$schema": "schemas/diagram.schema.json",
  "id": "signal_generator_demo",
  "title": "Signal Generator to Scope",
  "blocks": {
    "cos_gen_0": {
      "ref": "cos_gen_f32",
      "x": 40,
      "y": 100,
      "conf": {
        "precision": 10
      }
    },
    "scope_0": {
      "ref": "scope_f32",
      "x": 280,
      "y": 100
    }
  },
  "connections": {
    "cos_to_scope": {
      "from": {
        "block": "cos_gen_0",
        "port": { "id": "v", "vector_index": 0 }
      },
      "to": {
        "block": "scope_0",
        "port": { "id": "sink", "vector_index": 0 }
      }
    }
  }
}
```

> **Design Note on Serialization**:
> To ensure clean git diffs and compact payloads, block configuration properties set to their default schema values are **omitted** from JSON output.

---

## Getting Started

### Prerequisites

- **Node.js**: `v20.0.0` or later (LTS recommended)
- **npm**: `v10.0.0` or later

### Installation

Clone the repository and install all workspace dependencies:

```bash
git clone https://github.com/dzmauchy/bld.git
cd bld
npm install
```

### Build

Compile all workspaces and generate TypeScript declaration files:

```bash
# Build base, core, runtime, cpp, and ui
npm run build --workspaces
```

Or build specific workspaces:

```bash
npm run build --workspace=base     # Typechecks native header exports
npm run build --workspace=core     # Typechecks model and C++ builder
npm run build --workspace=runtime  # Typechecks wasm session and sliding buffers
npm run build --workspace=cpp      # Typechecks in-browser clang/lld
npm run build --workspace=ui       # Bundles Solid.js UI via Rsbuild
```

### Running the Development Server

Launch the Rsbuild development server with hot module reloading:

```bash
npm run dev --workspace=ui
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

### Running Tests

The workspace follows a tiered testing approach:

```bash
# Run all unit and integration test suites across all packages
npm test

# Run e2e tests for core C++ generation
npm run test:e2e --workspace=core

# Run Playwright clang/lld diagram execution tests (scopes + GPIO)
npm run test:e2e --workspace=cpp

# Run Playwright UI e2e tests
npm run test:e2e --workspace=ui
```

---

## Testing Strategy

The repository follows a clean, three-layer test layout:

```
├── tests/
│   ├── unit/          # Fast unit tests for isolated classes and data structures
│   └── integration/   # Multi-module integration tests (Wasm compilation, runtime workers)
└── e2e/               # End-to-end diagram compilation, session execution, and Playwright UI tests
```

- **Unit Tests**: Verify isolated models (`Diagram`, `CppDiagramBuilder`, `CppBlockCatalog`, `TypeSystem`, `SlidingScopeBuffer`).
- **Integration Tests**: Verify generated C++ matches JSON block refs and native `push::f32` class names.
- **E2E Tests**: Node generation tests in `core/e2e`, and in-browser clang/lld compile+run tests in `cpp/e2e/diagram.spec.ts` covering scopes and GPIO.

---

## License

This project is licensed under the **GNU Affero General Public License v3.0** (`AGPL-3.0-only`). See the [LICENSE](LICENSE) file for complete details.
