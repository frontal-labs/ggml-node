// Entry point for the worker process. The host forks this file. It has no other exports on purpose.
import { runWorker } from "@/backend/worker.js";

runWorker();
