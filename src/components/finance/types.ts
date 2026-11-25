import type { TenantWorkspaceData } from '../../shared/types';

export interface FinanceControlPanelProps {
  workspace: TenantWorkspaceData;
  canManage: boolean;
  canApproveBudgets?: boolean;
  actorRole: string;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}
