import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import { Observable, Subject } from 'rxjs';

interface TopologyUploadFile {
  originalname?: string;
  buffer?: Buffer;
  path?: string;
}
import type {
  TopologyImportEventRequest,
  TopologyImportKind,
  TopologyImportRealtimeEvent,
  TopologyImportRequest,
  TopologyImportResponse,
} from './planning.types';

@Injectable()
export class PlanningTopologyImportService {
  private readonly logger = new Logger(PlanningTopologyImportService.name);
  private readonly topologyImportEvents =
    new Subject<TopologyImportRealtimeEvent>();
  private readonly topologyScriptsDir = path.join(
    process.cwd(),
    'integrations',
    'topology-import',
  );
  private readonly topologyPythonBin =
    process.env.TOPOLOGY_IMPORT_PYTHON ?? 'python3';
  private readonly topologyImportCountry =
    process.env.TOPOLOGY_IMPORT_COUNTRY ?? 'DEU';
  private readonly topologyImportApiBase =
    process.env.TOPOLOGY_IMPORT_API_BASE ??
    process.env.TOPOLOGY_API_BASE ??
    'http://localhost:3000/api/v1';
  private readonly topologyNormalizePrefix =
    process.env.TOPOLOGY_IMPORT_NORMALIZE_PREFIX ?? 'DE';
  private readonly topologyNormalizeFill =
    process.env.TOPOLOGY_IMPORT_NORMALIZE_FILL ?? '0';
  private readonly topologySolPrefixes =
    process.env.TOPOLOGY_IMPORT_SOL_PREFIXES ??
    '0,1,2,3,4,5,6,7,8,9,A,B,C,D,E,F';
  private readonly runningTopologyProcesses = new Map<
    TopologyImportKind,
    ChildProcess
  >();

  async triggerTopologyImport(
    request?: TopologyImportRequest,
  ): Promise<TopologyImportResponse> {
    const requestedKinds = this.normalizeTopologyKinds(request?.kinds);
    const startedAt = new Date().toISOString();
    const normalizedKindsLabel = requestedKinds.length
      ? requestedKinds.join(', ')
      : 'keine gültigen Typen';
    this.logger.debug(
      `Topologie-Import-Trigger empfangen. Normalisierte Typen: ${normalizedKindsLabel}. Roh-Anfrage: ${JSON.stringify(
        request ?? {},
      )}`,
    );
    requestedKinds.forEach((kind) => {
      this.logger.log(
        `Topologie-Import für ${kind} wurde vom Frontend angestoßen.`,
      );
    });
    if (!requestedKinds.length) {
      this.logger.warn(
        'Topologie-Import wurde ohne gültige Typen angefragt und wird ignoriert.',
      );
      this.publishTopologyImportEvent({
        status: 'ignored',
        kinds: [],
        message: 'Keine gültigen Topologie-Typen übergeben.',
        source: 'backend',
      });
      return {
        startedAt,
        requestedKinds,
        message:
          'Import-Anfrage ignoriert – keine gültigen Typen. Migration oder Konfiguration prüfen.',
      };
    }
    this.publishTopologyImportEvent({
      status: 'queued',
      kinds: requestedKinds,
      message: `Import angefordert (${normalizedKindsLabel}). Python-Skripte melden Statusmeldungen über den Stream.`,
      source: 'backend',
    });
    this.launchTopologyImportScripts(requestedKinds);
    return {
      startedAt,
      requestedKinds,
      message: `Import wurde angestoßen (${normalizedKindsLabel}). Fortschritt siehe Stream /planning/topology/import/events.`,
    };
  }

  async uploadTopologyImportFile(file: TopologyUploadFile | undefined, kindRaw: string) {
    if (!file) {
      throw new BadRequestException('Keine Importdatei übergeben.');
    }
    const normalizedKind = this.normalizeTopologyKinds([kindRaw as TopologyImportKind])[0];
    if (!normalizedKind) {
      throw new BadRequestException(`Unbekannter Importtyp: ${kindRaw}`);
    }
    const uploadsDir = path.join(
      this.topologyScriptsDir,
      'import-data',
      'uploads',
      normalizedKind,
    );
    await fs.mkdir(uploadsDir, { recursive: true });
    const safeName = path.basename(file.originalname ?? 'import.dat');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetName = `${timestamp}_${safeName}`;
    const targetPath = path.join(uploadsDir, targetName);

    if (file.buffer && file.buffer.length) {
      await fs.writeFile(targetPath, file.buffer);
    } else if (file.path) {
      await fs.copyFile(file.path, targetPath);
    } else {
      throw new BadRequestException('Importdatei konnte nicht gelesen werden.');
    }

    this.publishTopologyImportEvent({
      status: 'queued',
      kinds: [normalizedKind],
      source: 'upload',
      message: `Importdatei gespeichert: ${targetName}`,
    });
    this.spawnTopologyUploadProcess(normalizedKind, targetPath);

    return {
      ok: true as const,
      kind: normalizedKind,
      fileName: targetName,
      storedAt: path.join('import-data', 'uploads', normalizedKind, targetName),
    };
  }

  streamTopologyImportEvents(): Observable<TopologyImportRealtimeEvent> {
    return new Observable<TopologyImportRealtimeEvent>((subscriber) => {
      this.logger.debug(
        'Neuer Listener für Topologie-Import-Events registriert.',
      );
      const subscription = this.topologyImportEvents.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      return () => {
        this.logger.debug(
          'Listener für Topologie-Import-Events wurde abgemeldet.',
        );
        subscription.unsubscribe();
      };
    });
  }

  publishTopologyImportEvent(
    request: TopologyImportEventRequest,
  ): TopologyImportRealtimeEvent {
    const event: TopologyImportRealtimeEvent = {
      timestamp: new Date().toISOString(),
      ...request,
    };
    const logParts = [
      `Topologie-Import-Event [${event.status}]`,
      `Quelle: ${event.source ?? 'unbekannt'}`,
      `Typen: ${event.kinds?.length ? event.kinds.join(', ') : 'keine Angabe'}`,
    ];
    if (event.message) {
      logParts.push(`Nachricht: ${event.message}`);
    }
    this.logger.debug(logParts.join(' | '));
    this.topologyImportEvents.next(event);
    return event;
  }

  private launchTopologyImportScripts(kinds: TopologyImportKind[]): void {
    kinds.forEach((kind) => {
      try {
        this.spawnTopologyProcess(kind);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Topologie-Skript für ${kind} konnte nicht gestartet werden: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        this.publishTopologyImportEvent({
          status: 'failed',
          kinds: [kind],
          source: 'backend',
          message: `Skript-Start fehlgeschlagen: ${message}`,
        });
      }
    });
  }

  private spawnTopologyProcess(kind: TopologyImportKind): void {
    if (this.runningTopologyProcesses.has(kind)) {
      this.logger.warn(
        `Topologie-Skript für ${kind} läuft bereits – erneuter Start wird ignoriert.`,
      );
      this.publishTopologyImportEvent({
        status: 'ignored',
        kinds: [kind],
        source: 'backend',
        message: 'Import bereits aktiv – erneuter Start ignoriert.',
      });
      return;
    }
    const definition = this.getTopologyScriptDefinition(kind);
    if (!definition) {
      this.logger.warn(
        `Kein Topologie-Skript für ${kind} konfiguriert – bitte Implementierung ergänzen.`,
      );
      this.publishTopologyImportEvent({
        status: 'failed',
        kinds: [kind],
        source: 'backend',
        message:
          'Kein Python-Skript für diesen Topologie-Typ hinterlegt. Bitte Backend anpassen.',
      });
      return;
    }
    const { script, args, source } = definition;
    const commandPreview = `${this.topologyPythonBin} ${script} ${args.join(' ')}`;
    this.logger.log(
      `Starte Topologie-Skript ${script} für ${kind}. Kommando: ${commandPreview}`,
    );
    this.publishTopologyImportEvent({
      status: 'in-progress',
      kinds: [kind],
      source,
      message: `Starte Skript ${script}`,
    });
    const child = spawn(this.topologyPythonBin, [script, ...args], {
      cwd: this.topologyScriptsDir,
      env: {
        ...process.env,
        TOPOLOGY_API_BASE: this.topologyImportApiBase,
        PYTHONUNBUFFERED: '1',
      },
    });
    this.runningTopologyProcesses.set(kind, child);
    if (child.stdout) {
      this.handleTopologyProcessOutput(kind, child.stdout, `${source}:stdout`);
    }
    if (child.stderr) {
      this.handleTopologyProcessOutput(kind, child.stderr, `${source}:stderr`);
    }

    child.on('error', (error) => {
      this.runningTopologyProcesses.delete(kind);
      this.logger.error(
        `Topologie-Skript ${script} konnte nicht gestartet werden: ${error.message}`,
        error.stack,
      );
      this.publishTopologyImportEvent({
        status: 'failed',
        kinds: [kind],
        source,
        message: `Skript-Start fehlgeschlagen: ${error.message}`,
      });
    });

    child.on('exit', (code, signal) => {
      this.runningTopologyProcesses.delete(kind);
      const success = typeof code === 'number' && code === 0 && !signal;
      const status = success ? 'succeeded' : 'failed';
      const reason = success
        ? `Skript ${script} beendet (Exit-Code ${code}).`
        : `Skript ${script} beendet (Exit-Code ${code ?? 'unbekannt'}, Signal ${signal ?? 'keins'}).`;
      if (success) {
        this.logger.log(reason);
      } else {
        this.logger.error(reason);
      }
      this.publishTopologyImportEvent({
        status,
        kinds: [kind],
        source,
        message: reason,
      });
    });
  }

  private handleTopologyProcessOutput(
    kind: TopologyImportKind,
    stream: Readable,
    source: string,
  ): void {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach((line) => this.emitTopologyProcessLine(kind, source, line));
    });
    stream.on('end', () => {
      if (buffer.trim().length) {
        this.emitTopologyProcessLine(kind, source, buffer);
      }
    });
  }

  private emitTopologyProcessLine(
    kind: TopologyImportKind,
    source: string,
    rawLine: string,
  ): void {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    const message = `[${source}] ${line}`;
    this.logger.debug(`Topologie-${kind}: ${message}`);
    this.publishTopologyImportEvent({
      status: 'in-progress',
      kinds: [kind],
      source,
      message,
    });
  }

  private spawnTopologyUploadProcess(kind: TopologyImportKind, filePath: string): void {
    if (this.runningTopologyProcesses.has(kind)) {
      this.logger.warn(
        `Topologie-Upload-Import für ${kind} läuft bereits – erneuter Start wird ignoriert.`,
      );
      this.publishTopologyImportEvent({
        status: 'ignored',
        kinds: [kind],
        source: 'upload',
        message: 'Import bereits aktiv – erneuter Start ignoriert.',
      });
      return;
    }
    const definition = this.getUploadScriptDefinition(kind, filePath);
    if (!definition) {
      this.logger.warn(
        `Kein Upload-Import-Skript für ${kind} konfiguriert – bitte Implementierung ergänzen.`,
      );
      this.publishTopologyImportEvent({
        status: 'failed',
        kinds: [kind],
        source: 'upload',
        message:
          'Kein Python-Skript für diesen Upload-Typ hinterlegt. Bitte Backend anpassen.',
      });
      return;
    }
    const { script, args, source } = definition;
    const commandPreview = `${this.topologyPythonBin} ${script} ${args.join(' ')}`;
    this.logger.log(
      `Starte Upload-Import-Skript ${script} für ${kind}. Kommando: ${commandPreview}`,
    );
    this.publishTopologyImportEvent({
      status: 'in-progress',
      kinds: [kind],
      source,
      message: `Starte Upload-Import ${script}`,
    });
    const child = spawn(this.topologyPythonBin, [script, ...args], {
      cwd: this.topologyScriptsDir,
      env: {
        ...process.env,
        TOPOLOGY_API_BASE: this.topologyImportApiBase,
        PYTHONUNBUFFERED: '1',
      },
    });
    this.runningTopologyProcesses.set(kind, child);
    if (child.stdout) {
      this.handleTopologyProcessOutput(kind, child.stdout, `${source}:stdout`);
    }
    if (child.stderr) {
      this.handleTopologyProcessOutput(kind, child.stderr, `${source}:stderr`);
    }

    child.on('error', (error) => {
      this.runningTopologyProcesses.delete(kind);
      this.logger.error(
        `Upload-Import-Skript ${script} konnte nicht gestartet werden: ${error.message}`,
        error.stack,
      );
      this.publishTopologyImportEvent({
        status: 'failed',
        kinds: [kind],
        source,
        message: `Skript-Start fehlgeschlagen: ${error.message}`,
      });
    });

    child.on('exit', (code, signal) => {
      this.runningTopologyProcesses.delete(kind);
      const success = typeof code === 'number' && code === 0 && !signal;
      const status = success ? 'succeeded' : 'failed';
      const reason = success
        ? `Upload-Import ${script} beendet (Exit-Code ${code}).`
        : `Upload-Import ${script} beendet (Exit-Code ${code ?? 'unbekannt'}, Signal ${signal ?? 'keins'}).`;
      if (success) {
        this.logger.log(reason);
      } else {
        this.logger.error(reason);
      }
      this.publishTopologyImportEvent({
        status,
        kinds: [kind],
        source,
        message: reason,
      });
    });
  }

  private getTopologyScriptDefinition(kind: TopologyImportKind): {
    script: string;
    args: string[];
    source: string;
  } | null {
    if (kind === 'operational-points') {
      return {
        script: 'era_ops_export-V1.0.py',
        args: this.buildOpsImportArgs(),
        source: 'era_ops_export',
      };
    }
    if (kind === 'sections-of-line') {
      return {
        script: 'era_sols_export-v1.0.py',
        args: this.buildSolImportArgs(),
        source: 'era_sols_export',
      };
    }
    return null;
  }

  private getUploadScriptDefinition(
    kind: TopologyImportKind,
    filePath: string,
  ): { script: string; args: string[]; source: string } | null {
    const script = 'topology_upload_import.py';
    const args = [
      '--kind',
      kind,
      '--file',
      filePath,
      '--api-base',
      this.topologyImportApiBase,
    ];
    const importSource =
      process.env.TOPOLOGY_IMPORT_UPLOAD_SOURCE ?? 'topology_upload_backend_runner';
    if (importSource) {
      args.push('--import-source', importSource);
    }
    return {
      script,
      args,
      source: 'upload_import',
    };
  }

  private buildOpsImportArgs(): string[] {
    const args = [
      '--country',
      this.topologyImportCountry,
      '--api-base',
      this.topologyImportApiBase,
      '--page-size',
      process.env.TOPOLOGY_IMPORT_OPS_PAGE_SIZE ?? '1500',
      '--parallel',
      process.env.TOPOLOGY_IMPORT_OPS_PARALLEL ?? '5',
      '--timeout',
      process.env.TOPOLOGY_IMPORT_OPS_TIMEOUT ?? '120',
      '--retries',
      process.env.TOPOLOGY_IMPORT_OPS_RETRIES ?? '7',
    ];
    if (this.topologyNormalizePrefix) {
      args.push('--normalize-prefix', this.topologyNormalizePrefix);
    }
    if (this.topologyNormalizeFill) {
      args.push('--normalize-fillchar', this.topologyNormalizeFill);
    }
    const importSource =
      process.env.TOPOLOGY_IMPORT_OPS_SOURCE ?? 'era_ops_backend_runner';
    if (importSource) {
      args.push('--import-source', importSource);
    }
    return args;
  }

  private buildSolImportArgs(): string[] {
    const args = [
      '--country',
      this.topologyImportCountry,
      '--api-base',
      this.topologyImportApiBase,
      '--page-size',
      process.env.TOPOLOGY_IMPORT_SOLS_PAGE_SIZE ?? '1500',
      '--min-page-size',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_PAGE_SIZE ?? '300',
      '--timeout',
      process.env.TOPOLOGY_IMPORT_SOLS_TIMEOUT ?? '90',
      '--retries',
      process.env.TOPOLOGY_IMPORT_SOLS_RETRIES ?? '7',
      '--limit-sols',
      process.env.TOPOLOGY_IMPORT_SOLS_LIMIT ?? '0',
      '--batch-endpoints',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_ENDPOINTS ?? '120',
      '--min-batch-endpoints',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_ENDPOINTS ?? '40',
      '--batch-meta',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_META ?? '80',
      '--min-batch-meta',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_META ?? '10',
      '--batch-opids',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_OPIDS ?? '120',
      '--min-batch-opids',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_OPIDS ?? '40',
      '--batch-track-dirs',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_TRACK_DIRS ?? '120',
      '--min-batch-track-dirs',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_TRACK_DIRS ?? '40',
      '--batch-track-prop',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_TRACK_PROP ?? '80',
      '--min-batch-track-prop',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_TRACK_PROP ?? '30',
      '--batch-labels',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_LABELS ?? '20',
      '--min-batch-labels',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_LABELS ?? '5',
    ];
    if (this.topologySolPrefixes) {
      args.push('--sol-prefixes', this.topologySolPrefixes);
    }
    if (this.getBooleanEnv('TOPOLOGY_IMPORT_SOLS_SKIP_ON_TIMEOUT', true)) {
      args.push('--skip-on-timeout');
    }
    if (this.topologyNormalizePrefix) {
      args.push('--normalize-prefix', this.topologyNormalizePrefix);
    }
    if (this.topologyNormalizeFill) {
      args.push('--normalize-fillchar', this.topologyNormalizeFill);
    }
    const importSource =
      process.env.TOPOLOGY_IMPORT_SOLS_SOURCE ?? 'era_sols_backend_runner';
    if (importSource) {
      args.push('--import-source', importSource);
    }
    return args;
  }

  private getBooleanEnv(key: string, fallback: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined) {
      return fallback;
    }
    return ['1', 'true', 'on', 'yes'].includes(raw.toLowerCase());
  }

  private normalizeTopologyKinds(
    kinds?: TopologyImportKind[],
  ): TopologyImportKind[] {
    const allowed: TopologyImportKind[] = [
      'operational-points',
      'sections-of-line',
      'station-areas',
      'tracks',
      'platform-edges',
      'platforms',
      'sidings',
      'personnel-sites',
      'replacement-stops',
      'replacement-routes',
      'replacement-edges',
      'op-replacement-stop-links',
      'transfer-edges',
    ];
    if (!kinds?.length) {
      return [...allowed];
    }
    const allowedSet = new Set<TopologyImportKind>(allowed);
    const normalized: TopologyImportKind[] = [];
    kinds.forEach((kind) => {
      if (allowedSet.has(kind) && !normalized.includes(kind)) {
        normalized.push(kind);
      }
    });
    return normalized;
  }
}
