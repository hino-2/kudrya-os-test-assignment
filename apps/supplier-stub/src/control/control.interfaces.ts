import type { IInventoryView } from '../issue/issue.interfaces';
import type { IScenarioState } from '../scenario/scenario.interfaces';

export interface IControlStateResponse {
  scenario: IScenarioState;
  inventory: IInventoryView;
  issuedCount: number;
}
