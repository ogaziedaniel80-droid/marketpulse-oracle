import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadOpenApiSpec(): Record<string, unknown> {
  const specPath = path.resolve(__dirname, '../openapi.yaml');
  if (!fs.existsSync(specPath)) {
    throw new Error(`OpenAPI spec not found at: ${specPath}`);
  }
  const content = fs.readFileSync(specPath, 'utf8');
  return yaml.parse(content);
}

export function validateOpenApiSpec(): { valid: boolean; pathCount: number } {
  const spec = loadOpenApiSpec() as {
    openapi?: string;
    info?: unknown;
    paths?: Record<string, unknown>;
  };
  if (!spec.openapi || !spec.info || !spec.paths) {
    throw new Error('Invalid OpenAPI 3.1 structure: missing openapi, info, or paths');
  }
  const pathCount = Object.keys(spec.paths).length;
  return { valid: true, pathCount };
}
