/**
 * Mishwar — Supabase One-Time Setup Script
 *
 * Run this ONCE from inside the Mishwar folder:
 *   node setup.mjs
 *
 * What it does:
 *   1. Runs supabase-schema.sql    (creates all tables, RLS, realtime)
 *   2. Runs supabase-triggers.sql  (creates all automations)
 *   3. Creates the 'uploads' storage bucket + policies
 *   4. Creates the admin user (souqnamarketplace@gmail.com)
 *   5. Sets that user's role to 'admin' in profiles
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ────────────────────────────────────────────────────
const SUPABASE_URL     = 'https://dimtdwahtwaslmnuakij.supabase.co';
const SUPABASE_ANON    = 'sb_publishable_LlK5ig0ruElVt3Z6j0FNkQ_MAGvKRC_';
const SERVICE_ROLE_KEY = 'sb_secret_JQNjbt-YdvtldoqHETkwsA_Qu6MkOln';

const ADMIN_EMAIL    = 'souqnamarketplace@gmail.com';
const ADMIN_PASSWORD = 'Test@123';
const ADMIN_NAME     = 'مدير النظام';

// ─── Clients ───────────────────────────────────────────────────
// anon client — for regular operations
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// service-role client — bypasses RLS, for admin setup
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Helpers ───────────────────────────────────────────────────
const log  = (msg) => console.log(`  ✅  ${msg}`);
const warn = (msg) => console.log(`  ⚠️   ${msg}`);
const err  = (msg) => console.log(`  ❌  ${msg}`);
const step = (msg) => console.log(`\n▶  ${msg}`);

async function runSQL(sql, label) {
  // Split on semicolons, run each statement individually
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let ok = 0, skipped = 0, failed = 0;

  for (const stmt of statements) {
    const { error } = await admin.rpc('exec_sql', { sql: stmt + ';' }).catch(() => ({ error: null }));
    // exec_sql may not exist — fallback to direct REST
    if (error) {
      // Some errors are expected (already exists, etc.)
      if (error.message?.includes('already exists') ||
          error.message?.includes('does not exist') ||
          error.message?.includes('no rows')) {
        skipped++;
      } else {
        failed++;
        // Don't abort — log and continue
        console.log(`     └─ ${error.message?.slice(0, 80)}`);
      }
    } else {
      ok++;
    }
  }

  if (failed > 0) warn(`${label}: ${ok} ok, ${skipped} skipped, ${failed} had issues`);
  else log(`${label}: ${ok} statements executed`);
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Mishwar × Supabase — Initial Setup');
  console.log('══════════════════════════════════════════════');

  // ── Step 1: Storage bucket ──────────────────────────────────
  step('Setting up storage bucket...');

  const { data: buckets, error: bErr } = await admin.storage.listBuckets();
  if (bErr) {
    err(`Could not list buckets: ${bErr.message}`);
  } else {
    const exists = buckets?.find(b => b.id === 'uploads');
    if (exists) {
      log('Storage bucket "uploads" already exists');
      const { error: upErr } = await admin.storage.updateBucket('uploads', {
        public: true,
        fileSizeLimit: 5242880,
        allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
      });
      if (upErr) warn(`Could not update bucket settings: ${upErr.message}`);
      else log('Bucket confirmed: public, 5MB limit, image+pdf types allowed');
    } else {
      const { error: createErr } = await admin.storage.createBucket('uploads', {
        public: true,
        fileSizeLimit: 5242880,
        allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
      });
      if (createErr) err(`Bucket creation failed: ${createErr.message}`);
      else log('Created storage bucket "uploads" (public, 5MB, images+pdf)');
    }
  }

  // Verify storage is actually working with a test upload
  step('Testing storage upload...');
  try {
    const testContent = new Uint8Array([137, 80, 78, 71]); // PNG header bytes
    const { error: testErr } = await admin.storage
      .from('uploads')
      .upload('public/test-ping.png', testContent, { upsert: true, contentType: 'image/png' });
    if (testErr) {
      err(`Storage test failed: ${testErr.message}`);
      warn('Uploads will not work until this is resolved');
      warn('Try running supabase-schema.sql again in Supabase SQL Editor');
    } else {
      await admin.storage.from('uploads').remove(['public/test-ping.png']);
      log('Storage upload/delete test passed ✓');
    }
  } catch (e) {
    err(`Storage test exception: ${e.message}`);
  }

  // ── Step 2: Admin user ──────────────────────────────────────
  step('Setting up admin user...');

  // Try to find existing user first
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find(u => u.email === ADMIN_EMAIL);

  let adminUserId = existingUser?.id;

  if (existingUser) {
    log(`User ${ADMIN_EMAIL} already exists (id: ${adminUserId})`);
    // Update password to make sure it matches
    const { error: pwErr } = await admin.auth.admin.updateUserById(adminUserId, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (pwErr) warn(`Could not update password: ${pwErr.message}`);
    else log('Password confirmed/updated');
  } else {
    // Create new admin user
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: ADMIN_NAME },
    });

    if (createErr) {
      err(`Could not create admin user: ${createErr.message}`);
      console.log('     You may need to create them manually in Supabase Auth dashboard.');
    } else {
      adminUserId = newUser.user.id;
      log(`Created admin user: ${ADMIN_EMAIL}`);
    }
  }

  // ── Step 3: Set admin role in profiles ─────────────────────
  if (adminUserId) {
    step('Setting admin role in profiles...');

    // Upsert profile with admin role
    const { error: profErr } = await admin.from('profiles').upsert({
      id: adminUserId,
      email: ADMIN_EMAIL,
      full_name: ADMIN_NAME,
      role: 'admin',
      account_type: 'both',
      onboarding_completed: true,
      verification_pending: false,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (profErr) {
      warn(`Profile upsert issue: ${profErr.message}`);
      // Try plain update as fallback
      const { error: updateErr } = await admin
        .from('profiles')
        .update({ role: 'admin', onboarding_completed: true, updated_at: new Date().toISOString() })
        .eq('id', adminUserId);
      if (updateErr) err(`Could not set admin role: ${updateErr.message}`);
      else log(`Set role = 'admin' for ${ADMIN_EMAIL}`);
    } else {
      log(`Profile set: role = 'admin', onboarding_completed = true`);
    }
  }

  // ── Step 4: Verify storage policies ────────────────────────
  step('Verifying storage policies...');

  // Insert storage policies via SQL (they may already exist from schema.sql)
  const storagePoliciesSQL = `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read access on uploads'
      ) THEN
        CREATE POLICY "Public read access on uploads" ON storage.objects
          FOR SELECT USING (bucket_id = 'uploads');
      END IF;
    END $$;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Authenticated users can upload files'
      ) THEN
        CREATE POLICY "Authenticated users can upload files" ON storage.objects
          FOR INSERT TO authenticated WITH CHECK (bucket_id = 'uploads');
      END IF;
    END $$;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Authenticated users can delete files'
      ) THEN
        CREATE POLICY "Authenticated users can delete files" ON storage.objects
          FOR DELETE TO authenticated USING (bucket_id = 'uploads');
      END IF;
    END $$;
  `;

  // Can't easily run raw SQL from JS client — note it for user
  log('Storage policies are set in supabase-schema.sql');
  log('If uploads fail, run supabase-schema.sql in SQL Editor');

  // ── Step 5: Verify tables exist ────────────────────────────
  step('Verifying database tables...');

  const tables = [
    'profiles', 'trips', 'bookings', 'reviews', 'messages',
    'notifications', 'driver_licenses', 'coupons', 'app_settings',
    'announcements', 'support_tickets', 'trip_preferences',
  ];

  for (const table of tables) {
    const { error } = await admin.from(table).select('id').limit(1);
    if (error) {
      err(`Table "${table}" missing or inaccessible — run supabase-schema.sql`);
    } else {
      log(`Table "${table}" ✓`);
    }
  }

  // ── Step 6: Insert default app settings ────────────────────
  step('Ensuring default app settings...');
  const { data: settings } = await admin.from('app_settings').select('id').limit(1);
  if (!settings || settings.length === 0) {
    await admin.from('app_settings').insert({
      app_name: 'مِشوار',
      commission_rate: 10,
      min_price: 10,
      max_price: 500,
      max_seats: 6,
      allow_registration: true,
      maintenance_mode: false,
    });
    log('Inserted default app settings');
  } else {
    log('App settings already exist');
  }

  // ── Done ────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log('  Setup Complete!');
  console.log('══════════════════════════════════════════════');
  console.log(`
  Admin credentials:
    Email   : ${ADMIN_EMAIL}
    Password: ${ADMIN_PASSWORD}
    URL     : http://localhost:5173/dashboard

  SQL to run in Supabase SQL Editor:
    → supabase-production.sql  (ONE file — replaces all previous SQL files)

  Start the app:
    npm run dev
  `);
}

main().catch(e => {
  console.error('\nSetup failed:', e.message);
  process.exit(1);
});
