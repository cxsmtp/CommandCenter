// The container's health check: exit 0 when the server answers /healthz (HTTPS or http), 1 otherwise.
import { probe } from './probe.js';

const r = await probe(Number(process.env.PORT) || 4310);
process.exit(r?.ok ? 0 : 1);
