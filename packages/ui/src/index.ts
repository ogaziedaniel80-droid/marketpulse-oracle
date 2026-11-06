export const UI_VERSION = '0.1.0';

export interface UIComponentProps {
  className?: string;
}

export type StatusBadgeType =
  'active' | 'open' | 'resolving' | 'finalised' | 'disputed' | 'cancelled' | 'slashed';

export function renderStatusBadge(status: StatusBadgeType): string {
  const styles: Record<StatusBadgeType, { bg: string; text: string; label: string }> = {
    active: { bg: '#065f46', text: '#ecfdf5', label: 'Active' },
    open: { bg: '#1e40af', text: '#eff6ff', label: 'Open' },
    resolving: { bg: '#854d0e', text: '#fefce8', label: 'Resolving' },
    finalised: { bg: '#166534', text: '#f0fdf4', label: 'Finalised' },
    disputed: { bg: '#991b1b', text: '#fef2f2', label: 'Disputed' },
    cancelled: { bg: '#475569', text: '#f8fafc', label: 'Cancelled' },
    slashed: { bg: '#7f1d1d', text: '#fee2e2', label: 'Slashed' },
  };

  const s = styles[status] || styles.open;
  return `<span class="badge" style="background:${s.bg}; color:${s.text}; padding:4px 10px; border-radius:9999px; font-size:12px; font-weight:600;">${s.label}</span>`;
}

export interface StakeAtRiskCardProps {
  stakeUsdc: string;
  stakeNgn: string;
  gentleSlashPenaltyUsdc: string;
  gentleSlashPenaltyNgn: string;
  nonRevealSlashUsdc: string;
  nonRevealSlashNgn: string;
}

export function renderStakeAtRiskCard(props: StakeAtRiskCardProps): string {
  return `
<div class="stake-card" style="background:#1e293b; border:2px solid #f59e0b; border-radius:12px; padding:16px; margin:12px 0;">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <h3 style="margin:0; color:#fbbf24; font-size:16px;">⚠️ Mandatory Stake at Risk Disclosure</h3>
    <span style="font-weight:700; color:#ffffff;">${props.stakeUsdc} USDC (~${props.stakeNgn})</span>
  </div>
  <p style="margin:8px 0; font-size:13px; color:#cbd5e1;">
    Your stake is locked during reporting. Accurate reports within tolerance recover stake plus bounty bonus.
  </p>
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; font-size:12px;">
    <div style="background:#451a03; padding:8px; border-radius:6px; color:#fed7aa;">
      <strong>Outlier Deviation (25%):</strong><br/>-${props.gentleSlashPenaltyUsdc} USDC (-${props.gentleSlashPenaltyNgn})
    </div>
    <div style="background:#450a0a; padding:8px; border-radius:6px; color:#fecaca;">
      <strong>Non-Reveal / Fraud (80–100%):</strong><br/>-${props.nonRevealSlashUsdc} USDC (-${props.nonRevealSlashNgn})
    </div>
  </div>
</div>
  `.trim();
}
