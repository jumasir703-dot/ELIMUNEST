import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../server';
import { ST_RAPHAEL_TENANT_ID } from '../server/seedStRaphael';
import {
  buildSystemSearchCatalog,
  runSystemSearch,
  splitHighlightSegments,
} from '../src/lib/globalSearch';
import { getEffectiveUserModules } from '../src/shared/types';

describe('Universal System Search Catalog & Ranking', () => {
  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    await store.resetForTests({ empty: false, includeLargeTenants: true });
  });

  it('indexes all St. Raphael system modules, learners, faculty, leave chits, academics, exams, and finance for Admin', () => {
    const adminUser = store
      .listUsersForTenant(ST_RAPHAEL_TENANT_ID)
      .find((u) => u.email === 'juma.j@straphael.ac.ke');
    expect(adminUser).toBeDefined();

    const ws = store.getWorkspace(ST_RAPHAEL_TENANT_ID, adminUser);
    const catalog = buildSystemSearchCatalog({
      workspace: ws,
      currentRole: adminUser!.role,
      effectiveModules: getEffectiveUserModules(adminUser),
      canAccessSuperAdmin: true,
      isPlatformSuperAdmin: false,
      darkMode: false,
    });

    // Leave chits with delegated duties searchable by reason or delegate name
    const leaveHit = runSystemSearch(catalog, 'KNEC CBC Assessment', 'all');
    expect(leaveHit.results.some((r) => r.typeLabel === 'Teacher Leave Chit')).toBe(true);

    // Modules & Workflows searchable
    const progHit = runSystemSearch(catalog, 'progressive report', 'navigation');
    expect(
      progHit.results.some((r) => r.target.module === 'exams' && r.target.subTab === 'progressive')
    ).toBe(true);

    // Learners searchable by name or code with quick-jump secondary actions
    const sampleStu = ws.students[0];
    const stuHit = runSystemSearch(catalog, sampleStu.studentCode, 'students');
    expect(stuHit.results[0]?.id).toBe(`stu-${sampleStu.id}`);
    expect(stuHit.results[0]?.secondaryActions?.some((a) => a.label === 'Report Card')).toBe(true);
    expect(stuHit.results[0]?.secondaryActions?.some((a) => a.label === 'Fees')).toBe(true);

    // Invoices searchable by invoiceNumber & receipt
    const sampleInv = ws.invoices[0];
    const invHit = runSystemSearch(catalog, sampleInv.invoiceNumber, 'finance');
    expect(invHit.results.some((r) => r.id === `inv-${sampleInv.id}`)).toBe(true);

    // Lesson notes & Schemes of Work searchable
    const schemesHit = runSystemSearch(catalog, 'Mathematics', 'academics');
    expect(schemesHit.results.length).toBeGreaterThan(0);

    // Match highlighter splits cleanly
    const segments = splitHighlightSegments('Grade 9 Mathematics Scheme', 'mathematics');
    expect(segments.some((s) => s.match && s.text.toLowerCase() === 'mathematics')).toBe(true);
  });

  it('strictly scopes universal search catalog to role permissions (Parent & Bursar)', () => {
    const parentUser = store
      .listUsersForTenant(ST_RAPHAEL_TENANT_ID)
      .find((u) => u.role === 'Parent');
    expect(parentUser).toBeDefined();
    const parentWs = store.getWorkspace(ST_RAPHAEL_TENANT_ID, parentUser);
    const parentCatalog = buildSystemSearchCatalog({
      workspace: parentWs,
      currentRole: parentUser!.role,
      effectiveModules: getEffectiveUserModules(parentUser),
      canAccessSuperAdmin: false,
      isPlatformSuperAdmin: false,
      darkMode: false,
    });

    // Parents must never see Teacher Leave Out Chits, Payroll, Expenses, or Settings Staff matrix
    expect(parentCatalog.some((i) => i.typeLabel === 'Teacher Leave Chit')).toBe(false);
    expect(parentCatalog.some((i) => i.typeLabel === 'Expense Voucher')).toBe(false);
    expect(parentCatalog.some((i) => i.typeLabel === 'Teacher')).toBe(false);
    expect(parentCatalog.some((i) => i.target.module === 'settings')).toBe(false);

    // Parents can still find their own child, fee invoices, progressive reports, and curriculum
    expect(parentCatalog.some((i) => i.category === 'students')).toBe(true);
    expect(parentCatalog.some((i) => i.target.module === 'academics')).toBe(true);

    // Bursar only sees finance/communications/analytics modules
    const bursarUser = store
      .listUsersForTenant(ST_RAPHAEL_TENANT_ID)
      .find((u) => u.role === 'Bursar');
    expect(bursarUser).toBeDefined();
    const bursarWs = store.getWorkspace(ST_RAPHAEL_TENANT_ID, bursarUser);
    const bursarCatalog = buildSystemSearchCatalog({
      workspace: bursarWs,
      currentRole: bursarUser!.role,
      effectiveModules: getEffectiveUserModules(bursarUser),
      canAccessSuperAdmin: false,
      isPlatformSuperAdmin: false,
      darkMode: false,
    });

    expect(bursarCatalog.some((i) => i.target.module === 'exams')).toBe(false);
    expect(bursarCatalog.some((i) => i.target.module === 'academics')).toBe(false);
    expect(bursarCatalog.some((i) => i.category === 'finance')).toBe(true);
  });
});
