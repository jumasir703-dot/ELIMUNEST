import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { ParentSignupForm } from '../src/components/ParentSignupForm';
import { LinkChildCard } from '../src/components/LinkChildCard';
import { ParentLinksModal } from '../src/components/ParentLinksModal';
import { AuthPortal } from '../src/components/AuthPortal';
import type { TenantWorkspaceData } from '../src/shared/types';

describe('Parent screens render', () => {
  it('renders the sign-in screen with a parent sign-up entry point', () => {
    const html = renderToString(
      createElement(AuthPortal, { darkMode: false, onToggleDarkMode: () => {}, onAuthenticated: () => {} })
    );
    expect(html).toContain('Parent or guardian?');
    expect(html).toContain('Create an account');
  });

  it('renders the parent sign-up form with ownership-proof fields', () => {
    const html = renderToString(
      createElement(ParentSignupForm, { onAuthenticated: () => {}, onBack: () => {}, onError: () => {} })
    );
    expect(html).toContain('Child’s admission no.');
    expect(html).toContain('Guardian phone on file');
    expect(html).toContain('Create parent account');
  });

  it('renders the link-child card open when no learner is linked, collapsed otherwise', () => {
    const empty = renderToString(createElement(LinkChildCard, { tenantId: 't1', linkedCount: 0, onLinked: () => {} }));
    expect(empty).toContain('Link your child to this account');
    expect(empty).toContain('Admission number');
    const some = renderToString(createElement(LinkChildCard, { tenantId: 't1', linkedCount: 2, onLinked: () => {} }));
    expect(some).toContain('Link another child');
    expect(some).not.toContain('Admission number');
  });

  it('renders the admin parent-links panel with linked and unlinked learners', () => {
    const base = {
      tenantId: 't1', studentCode: '', grade: 'Grade 6', section: 'A', gender: 'Female', dateOfBirth: '2014-01-01',
      guardianName: 'G', guardianPhone: '+254712000001', guardianEmail: '', status: 'Active', upi: 'U1', enrolledAt: '2026-01-01',
    };
    const workspace = {
      tenant: { id: 't1', name: 'Test School' },
      students: [
        { ...base, id: 's1', fullName: 'Amina Linked', studentCode: 'ADM-1', parentUserId: 'p1' },
        { ...base, id: 's2', fullName: 'Brian Free', studentCode: 'ADM-2' },
      ],
    } as unknown as TenantWorkspaceData;
    const html = renderToString(
      createElement(ParentLinksModal, { workspace, onClose: () => {}, onRefresh: async () => {}, onNotify: () => {} })
    );
    expect(html).toContain('Parent account links');
    expect(html).toContain('Amina Linked');
    expect(html).toContain('Brian Free');
    expect(html).toContain('Not linked');
  });
});
