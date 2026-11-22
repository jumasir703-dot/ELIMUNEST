import type { TenantWorkspaceData } from '../../shared/types';

export interface FinanceControlPanelProps {
  workspace: TenantWorkspaceData;
  canManage: boolean;
  canApprove?: boolean;
  actorRole: string;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}
