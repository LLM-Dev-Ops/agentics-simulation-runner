<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Google_Cloud_Run-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white" alt="Google Cloud Run" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/JSON_Schema-000000?style=for-the-badge&logo=json&logoColor=white" alt="JSON Schema" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/status-production-brightgreen?style=flat-square" alt="Status" />
  <img src="https://img.shields.io/badge/tests-23%20passed-success?style=flat-square" alt="Tests" />
</p>

---

# 🚀 Agentics Simulation Runner

**Deterministic execution engine for the Agentics ecosystem.** Executes `SimulationPlan` artifacts and produces immutable `SimulationResult` artifacts with full audit trails and reproducibility proofs.

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔒 **Contract Enforcement** | Strict JSON Schema validation at HTTP boundary using Ajv |
| 📊 **Execution Proof** | Multi-layer participation proof with `layers_executed` and `execution_graph` |
| 🔄 **Deterministic Execution** | Reproducible simulations with seeded PRNG |
| 📝 **Audit Trail** | Complete immutable audit log with Merkle tree verification |
| ⚡ **Cloud Native** | Optimized for Google Cloud Run deployment |
| 🧪 **Comprehensive Validation** | Schema, semantic, resource, connectivity, and pre-condition validation |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     HTTP Boundary (server.ts)                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           CONTRACT ENFORCEMENT (Ajv)                     │    │
│  │     simulation/v1/request.schema.json                    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Execution Layers                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │
│  │ Validation│→ │ Scheduling│→ │  Dispatch │→ │  Execution  │  │
│  └───────────┘  └───────────┘  └───────────┘  └─────────────┘  │
│                                                      │          │
│                                              ┌───────────────┐  │
│                                              │ Finalization  │  │
│                                              └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SimulationResult                              │
│  • execution_proof.layers_executed                               │
│  • execution_proof.execution_graph                               │
│  • audit_trail with Merkle root                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Installation

```bash
npm install
npm run build
```

### Run Locally

```bash
npm start
# Server starts on http://localhost:8080
```

### Run Tests

```bash
npm test
```

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/v1/runner` | API info with contract enforcement status |
| `POST` | `/v1/runner/submit` | Submit a simulation plan |
| `POST` | `/v1/runner/execute` | Submit and execute via engine |
| `GET` | `/v1/runner/status/:id` | Get execution status |
| `GET` | `/v1/runner/result/:id` | Get execution result |
| `POST` | `/v1/runner/abort/:id` | Abort execution |
| `GET` | `/v1/runner/health` | Detailed health status |
| `GET` | `/v1/runner/contracts` | Contract schema information |

## 📋 Contract Enforcement

All incoming simulation requests are validated against `contracts/simulation/v1/request.schema.json` **before** any execution logic runs.

### Single Validation Boundary

```typescript
// Contract validation happens ONLY at the HTTP boundary
// No duplicate validation downstream
validateRequestContract(body);  // Throws ContractValidationException if invalid
```

### Execution Proof

Every response includes an `execution_proof` demonstrating multi-layer participation:

```json
{
  "success": true,
  "result": { ... },
  "execution_proof": {
    "proofId": "uuid",
    "layers_executed": [
      { "layerId": "contract-validation", "layerType": "validation", "status": "success" },
      { "layerId": "scheduling", "layerType": "scheduling", "status": "success" },
      { "layerId": "dispatch", "layerType": "dispatch", "status": "success" },
      { "layerId": "execution", "layerType": "execution", "status": "success" },
      { "layerId": "finalization", "layerType": "finalization", "status": "success" }
    ],
    "execution_graph": {
      "nodes": [...],
      "edges": [...]
    },
    "layerCount": 5,
    "complete": true
  }
}
```

## 📦 Project Structure

```
agentics-simulation-runner/
├── contracts/
│   └── simulation/v1/
│       └── request.schema.json    # JSON Schema for request validation
├── src/
│   ├── api/
│   │   ├── execution-gateway.ts   # Main gateway implementation
│   │   └── execution-handle.ts    # Execution handle utilities
│   ├── contracts/
│   │   └── index.ts               # Ajv contract validator
│   ├── orchestration/
│   │   ├── validation-orchestrator.ts
│   │   └── validators/            # Validation modules
│   ├── core/
│   │   ├── hash-utils.ts          # SHA-256, Merkle trees
│   │   └── deterministic-random.ts
│   ├── state/
│   │   └── state-repository.ts    # PostgreSQL state management
│   ├── engine/
│   │   └── index.ts               # Engine integration
│   ├── types/
│   │   ├── simulation-plan.ts     # SimulationPlan types
│   │   └── simulation-result.ts   # SimulationResult types
│   ├── server.ts                  # HTTP server with contract enforcement
│   └── index.ts                   # Public exports
├── tests/
│   └── contracts/
│       └── contract-validator.test.ts
├── Dockerfile
└── package.json
```

## ☁️ Deployment

### Google Cloud Run

```bash
# Set project
gcloud config set project YOUR_PROJECT_ID

# Deploy
gcloud run deploy agentics-simulation-runner \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --port 8080
```

### Production URL

```
https://agentics-simulation-runner-1062287243982.us-central1.run.app
```

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `NODE_ENV` | `development` | Environment mode |

## 📊 Validation Pipeline

The runner validates plans through 5 phases:

1. **Schema Validation** (INV-IN-001) - JSON Schema validation via Ajv at HTTP boundary
2. **Semantic Validation** (INV-IN-002, INV-IN-003) - Hash verification, dependency cycles, references
3. **Resource Validation** (INV-IN-007) - CPU, memory, storage limits
4. **Connectivity Validation** (INV-IN-006) - Integration endpoint reachability
5. **Pre-Condition Evaluation** - Custom pre-conditions from plan

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/contracts/contract-validator.test.ts

# Run with coverage
npm run test:coverage
```

## 📄 License

MIT

## 🔗 Related Projects

- [agentics-simulation-planner](https://github.com/agentics/agentics-simulation-planner) - Plan generation
- [agentics-simulation-engine](https://github.com/agentics/agentics-simulation-engine) - Execution engine
- [ruvvector-postgres](https://github.com/agentics/ruvvector-postgres) - State management
