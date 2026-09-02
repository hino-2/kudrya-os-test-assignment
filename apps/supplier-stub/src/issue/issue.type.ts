import type { IIssueRecord } from '../persistence/stub-state.interfaces';
import type { ScenarioMode } from '../scenario/scenario.type';
import type { IIssueErrorBody, IIssueResult } from './issue.interfaces';

export type IssueMintMode = 'ok' | 'slow' | 'issue_then_hang';

export type IssueDecision =
  | { kind: 'replayed'; record: IIssueRecord }
  | { kind: 'minted'; mode: IssueMintMode; record: IIssueRecord }
  | { kind: 'blocked'; mode: Exclude<ScenarioMode, IssueMintMode | 'normal'> };

export type IssueOutcome =
  | { action: 'respond'; status: number; body: IIssueResult | IIssueErrorBody }
  | { action: 'respond_garbage'; status: number; body: string }
  | { action: 'hang' }
  | { action: 'refuse' };
