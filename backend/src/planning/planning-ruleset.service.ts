import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import Ajv, { ValidateFunction } from 'ajv';
import type { RulesetDocument, RulesetInclude, RulesetIR } from './planning-ruleset.types';
import { compileRuleset, mergeRulesetDocuments } from './planning-ruleset.compiler';

@Injectable()
export class PlanningRulesetService {
  private readonly validator: ValidateFunction;
  private readonly rulesetRoot: string;

  constructor() {
    this.rulesetRoot = this.resolveRulesetRoot();
    const schema = this.loadRulesetSchema();
    const ajv = new Ajv({ allErrors: true });
    this.validator = ajv.compile(schema);
  }

  listRulesets(): string[] {
    this.assertRulesetRoot();
    return readdirSync(this.rulesetRoot)
      .filter((entry) => this.isDirectory(join(this.rulesetRoot, entry)))
      .sort((a, b) => a.localeCompare(b));
  }

  listVersions(rulesetId: string): string[] {
    const dir = this.resolveRulesetDir(rulesetId);
    return readdirSync(dir)
      .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml') || entry.endsWith('.json'))
      .map((entry) => entry.replace(/\.(yaml|yml|json)$/i, ''))
      .sort((a, b) => a.localeCompare(b));
  }

  getRuleset(rulesetId: string, version: string): RulesetDocument {
    const { document } = this.loadRulesetWithIncludes(rulesetId, version);
    return document;
  }

  getCompiledRuleset(rulesetId: string, version: string): RulesetIR {
    const { document, includes } = this.loadRulesetWithIncludes(rulesetId, version);
    return compileRuleset(document, includes);
  }

  validateRuleset(doc: RulesetDocument): { valid: boolean; errors: string[] } {
    const valid = this.validator(doc);
    if (valid) {
      return { valid: true, errors: [] };
    }
    return { valid: false, errors: this.formatValidationErrors() };
  }

  previewRuleset(doc: RulesetDocument, resolveIncludes = true): RulesetIR {
    const validation = this.validateRuleset(doc);
    if (!validation.valid) {
      const details = validation.errors.join('; ');
      throw new BadRequestException(`Ruleset payload ist ungueltig: ${details}`);
    }
    if (!resolveIncludes || !Array.isArray(doc.includes) || doc.includes.length === 0) {
      return compileRuleset({ ...doc, includes: [] }, []);
    }
    const { document, includes } = this.resolveIncludesForPayload(doc);
    return compileRuleset(document, includes);
  }

  parseRulesetPayload(payload: unknown): RulesetDocument {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Ruleset payload ist ungueltig.');
    }
    const maybeRaw = payload as { raw?: unknown; format?: unknown; document?: unknown };
    if (typeof maybeRaw.document === 'object' && maybeRaw.document !== null) {
      return this.coerceRulesetDocument(maybeRaw.document);
    }
    if (typeof maybeRaw.raw === 'string') {
      const format = typeof maybeRaw.format === 'string' ? maybeRaw.format.trim().toLowerCase() : 'yaml';
      const parsed = this.parseRawRuleset(maybeRaw.raw, format);
      return this.coerceRulesetDocument(parsed);
    }
    return this.coerceRulesetDocument(payload);
  }

  private loadRulesetWithIncludes(
    rulesetId: string,
    version: string,
    chain: string[] = [],
  ): { document: RulesetDocument; includes: RulesetInclude[] } {
    const key = `${rulesetId}:${version}`;
    if (chain.includes(key)) {
      throw new BadRequestException(`Ruleset include cycle detected: ${[...chain, key].join(' -> ')}`);
    }
    const nextChain = [...chain, key];
    const document = this.loadRulesetDefinition(rulesetId, version);
    const includes = Array.isArray(document.includes) ? document.includes : [];
    let merged: RulesetDocument = { ...document, includes: [] };
    const resolvedIncludes: RulesetInclude[] = [];

    for (const include of includes) {
      const includeId = `${include?.id ?? ''}`.trim();
      const includeVersion = `${include?.version ?? ''}`.trim();
      if (!includeId || !includeVersion) {
        throw new BadRequestException(`Ruleset include is invalid for ${key}`);
      }
      const included = this.loadRulesetWithIncludes(includeId, includeVersion, nextChain);
      merged = mergeRulesetDocuments(merged, included.document);
      resolvedIncludes.push({ id: includeId, version: includeVersion }, ...included.includes);
    }

    return {
      document: merged,
      includes: resolvedIncludes,
    };
  }

  private loadRulesetDefinition(rulesetId: string, version: string): RulesetDocument {
    const path = this.resolveRulesetFile(rulesetId, version);
    const raw = readFileSync(path, 'utf-8');
    const parsed = path.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException(`Ruleset ${rulesetId}/${version} ist leer oder ungueltig.`);
    }
    const doc = parsed as RulesetDocument;
    this.assertValid(doc, path);
    return doc;
  }

  private assertValid(doc: RulesetDocument, path: string): void {
    const valid = this.validator(doc);
    if (valid) {
      return;
    }
    const details = this.formatValidationErrors().join('; ');
    throw new BadRequestException(`Ruleset ${path} ist ungueltig: ${details}`);
  }

  private parseRawRuleset(raw: string, format: string): unknown {
    if (!raw.trim()) {
      throw new BadRequestException('Ruleset payload ist leer.');
    }
    if (format === 'json') {
      try {
        return JSON.parse(raw) as unknown;
      } catch (error) {
        throw new BadRequestException(`Ruleset JSON ist ungueltig: ${(error as Error).message ?? String(error)}`);
      }
    }
    try {
      return yaml.load(raw) as unknown;
    } catch (error) {
      throw new BadRequestException(`Ruleset YAML ist ungueltig: ${(error as Error).message ?? String(error)}`);
    }
  }

  private coerceRulesetDocument(value: unknown): RulesetDocument {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException('Ruleset payload ist ungueltig.');
    }
    return value as RulesetDocument;
  }

  private resolveIncludesForPayload(
    doc: RulesetDocument,
    chain: string[] = [],
  ): { document: RulesetDocument; includes: RulesetInclude[] } {
    const key = `payload:${doc.id}:${doc.version}`;
    if (chain.includes(key)) {
      throw new BadRequestException(`Ruleset include cycle detected: ${[...chain, key].join(' -> ')}`);
    }
    const nextChain = [...chain, key];
    const includes = Array.isArray(doc.includes) ? doc.includes : [];
    let merged: RulesetDocument = { ...doc, includes: [] };
    const resolvedIncludes: RulesetInclude[] = [];

    for (const include of includes) {
      const includeId = `${include?.id ?? ''}`.trim();
      const includeVersion = `${include?.version ?? ''}`.trim();
      if (!includeId || !includeVersion) {
        throw new BadRequestException(`Ruleset include is invalid for ${key}`);
      }
      const included = this.loadRulesetWithIncludes(includeId, includeVersion, nextChain);
      merged = mergeRulesetDocuments(merged, included.document);
      resolvedIncludes.push({ id: includeId, version: includeVersion }, ...included.includes);
    }

    return {
      document: merged,
      includes: resolvedIncludes,
    };
  }

  private formatValidationErrors(): string[] {
    return (this.validator.errors ?? []).map((entry) => {
      const entryPath =
        'instancePath' in entry
          ? entry.instancePath
          : 'dataPath' in entry
            ? entry.dataPath
            : '';
      const pathLabel = typeof entryPath === 'string' && entryPath.length > 0 ? entryPath : '/';
      return `${pathLabel} ${entry.message ?? ''}`.trim();
    });
  }

  private resolveRulesetRoot(): string {
    const candidates = [
      join(process.cwd(), 'rulesets'),
      join(process.cwd(), 'backend', 'rulesets'),
      join(__dirname, '..', '..', '..', 'rulesets'),
      join(__dirname, '..', '..', '..', 'backend', 'rulesets'),
    ];
    for (const candidate of candidates) {
      if (this.isDirectory(candidate)) {
        return candidate;
      }
    }
    return candidates[1];
  }

  private loadRulesetSchema(): Record<string, unknown> {
    const candidates = [
      join(process.cwd(), 'rulesets', 'schema', 'ruleset.schema.json'),
      join(process.cwd(), 'backend', 'rulesets', 'schema', 'ruleset.schema.json'),
      join(__dirname, '..', '..', '..', 'rulesets', 'schema', 'ruleset.schema.json'),
      join(__dirname, '..', '..', '..', 'backend', 'rulesets', 'schema', 'ruleset.schema.json'),
    ];
    for (const candidate of candidates) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf-8')) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
    throw new Error('Ruleset schema file not found.');
  }

  private resolveRulesetDir(rulesetId: string): string {
    this.assertRulesetRoot();
    const dir = join(this.rulesetRoot, rulesetId);
    if (!this.isDirectory(dir)) {
      throw new NotFoundException(`Ruleset ${rulesetId} nicht gefunden.`);
    }
    return dir;
  }

  private resolveRulesetFile(rulesetId: string, version: string): string {
    const dir = this.resolveRulesetDir(rulesetId);
    const base = join(dir, version);
    const candidates = [`${base}.yaml`, `${base}.yml`, `${base}.json`];
    for (const candidate of candidates) {
      if (this.isFile(candidate)) {
        return candidate;
      }
    }
    throw new NotFoundException(`Ruleset ${rulesetId}/${version} nicht gefunden.`);
  }

  private assertRulesetRoot(): void {
    if (!this.isDirectory(this.rulesetRoot)) {
      throw new NotFoundException('Ruleset root directory nicht gefunden.');
    }
  }

  private isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  private isFile(path: string): boolean {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }
}
